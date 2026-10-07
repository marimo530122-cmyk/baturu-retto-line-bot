"""APIの入口で「誰がアクセスしているか」「その役割で使ってよいか」を確認する仕組み。

各エンドポイントには `Depends(require_roles(Role.DOCTOR, ...))` のように、使ってよい役割を明示する。
役割の分け方(計画で合意した内容):
- 医師: 診察・録音・カルテ/処方/紹介状の作成と修正・看護師や薬局への送信
- 看護師: 患者一覧とカルテの閲覧・連携の受信箱の閲覧・会話の手入力
- 管理者: 職員アカウントの作成・停止・パスワード再発行のみ(カルテは見られない)
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, Header, HTTPException

from app.config import get_settings
from app.data import store
from app.models import Role, User
from app.services.auth import token_hash

# 操作のたびに保存ファイルへ書くと重いので、最終操作時刻はこの間隔ごとにだけファイルへ書く
# (メモリ上は毎回更新するので、自動ログアウトの判定は正確)
_ACTIVITY_PERSIST_INTERVAL = timedelta(seconds=60)

PASSWORD_CHANGE_REQUIRED = "最初にパスワードを変更してください。"


def authenticate_token(token: str | None, *, allow_password_change_pending: bool = False) -> User:
    """トークンを確認してユーザーを返す。使えないトークンなら 401、パスワード変更待ちなら 403。
    確認できたら「最後に操作した時刻」を更新する(=自動ログアウトまでの時間が延びる)。"""
    if not token:
        raise HTTPException(status_code=401, detail="ログインしてください。")
    hashed = token_hash(token)
    auth_session = store.get_auth_session(hashed)
    if auth_session is None:
        raise HTTPException(status_code=401, detail="ログインしてください。")

    now = datetime.utcnow()
    idle_limit = timedelta(minutes=get_settings().session_idle_minutes)
    if now - auth_session.last_activity_at > idle_limit:
        store.delete_auth_session(hashed)
        raise HTTPException(status_code=401, detail="一定時間操作がなかったため、ログアウトしました。")

    user = store.get_user(auth_session.user_id)
    if user is None or not user.is_active:
        store.delete_auth_session(hashed)
        raise HTTPException(status_code=401, detail="このアカウントは使用できません。")

    persist = now - auth_session.last_activity_at > _ACTIVITY_PERSIST_INTERVAL
    auth_session.last_activity_at = now
    if persist:
        store.save_auth_session(auth_session)

    if user.must_change_password and not allow_password_change_pending:
        raise HTTPException(status_code=403, detail=PASSWORD_CHANGE_REQUIRED)
    return user


def _bearer_token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def current_user(authorization: str | None = Header(default=None)) -> User:
    return authenticate_token(_bearer_token(authorization))


def current_user_allow_password_change(authorization: str | None = Header(default=None)) -> User:
    """パスワード変更待ちでも使える(自分の情報の確認・パスワード変更・ログアウト用)。"""
    return authenticate_token(_bearer_token(authorization), allow_password_change_pending=True)


def current_token(authorization: str | None = Header(default=None)) -> str | None:
    return _bearer_token(authorization)


def require_roles(*roles: Role):
    allowed = set(roles)

    def _check(user: User = Depends(current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=403, detail="この操作を行う権限がありません。")
        return user

    return _check


CLINICAL_STAFF = (Role.DOCTOR, Role.NURSE)
DOCTOR_ONLY = (Role.DOCTOR,)
ADMIN_ONLY = (Role.ADMIN,)
