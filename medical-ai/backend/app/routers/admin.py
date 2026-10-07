"""病院の管理者による職員アカウントの管理(作成・停止・パスワード再発行)。"""
from fastapi import APIRouter, Depends, HTTPException

from app.data import store
from app.deps import ADMIN_ONLY, require_roles
from app.models import PasswordResetIn, User, UserCreateIn, UserPublic, UserUpdateIn
from app.services.auth import hash_password, password_policy_error

router = APIRouter(prefix="/api/admin/users", tags=["admin"])


def _get_user_or_404(user_id: str) -> User:
    user = store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="職員が見つかりません")
    return user


def _check_password(password: str) -> None:
    error = password_policy_error(password)
    if error:
        raise HTTPException(status_code=400, detail=error)


@router.get("", response_model=list[UserPublic])
def list_users(_: User = Depends(require_roles(*ADMIN_ONLY))) -> list[UserPublic]:
    return [UserPublic.from_user(u) for u in store.list_users()]


@router.post("", response_model=UserPublic)
def create_user(body: UserCreateIn, _: User = Depends(require_roles(*ADMIN_ONLY))) -> UserPublic:
    login_id = body.login_id.strip()
    if not login_id or not body.display_name.strip():
        raise HTTPException(status_code=400, detail="ログインIDと名前を入力してください。")
    if store.find_user_by_login_id(login_id):
        raise HTTPException(status_code=409, detail="そのログインIDはすでに使われています。")
    _check_password(body.temporary_password)
    user = User(
        login_id=login_id,
        display_name=body.display_name.strip(),
        role=body.role,
        password_hash=hash_password(body.temporary_password),
        must_change_password=True,
    )
    store.save_user(user)
    return UserPublic.from_user(user)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: str, body: UserUpdateIn, admin: User = Depends(require_roles(*ADMIN_ONLY))
) -> UserPublic:
    user = _get_user_or_404(user_id)
    if user.id == admin.id and (body.is_active is False or (body.role and body.role != admin.role)):
        # 自分を停止・降格すると、管理者が誰もいなくなる事故が起きうるため
        raise HTTPException(status_code=400, detail="自分自身のアカウントは停止・役割変更できません。")
    for field in body.model_fields_set:
        value = getattr(body, field)
        if value is not None:
            setattr(user, field, value.strip() if isinstance(value, str) else value)
    store.save_user(user)
    if not user.is_active or "role" in body.model_fields_set:
        store.delete_auth_sessions_for_user(user.id)
    return UserPublic.from_user(user)


@router.post("/{user_id}/reset-password", response_model=UserPublic)
def reset_password(
    user_id: str, body: PasswordResetIn, _: User = Depends(require_roles(*ADMIN_ONLY))
) -> UserPublic:
    user = _get_user_or_404(user_id)
    _check_password(body.temporary_password)
    user.password_hash = hash_password(body.temporary_password)
    user.must_change_password = True
    user.failed_login_count = 0
    user.locked_until = None
    store.save_user(user)
    store.delete_auth_sessions_for_user(user.id)
    return UserPublic.from_user(user)
