from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.data import store
from app.deps import current_token, current_user_allow_password_change
from app.models import AuthSession, ChangePasswordIn, LoginIn, LoginOut, User, UserPublic
from app.services.auth import (
    hash_password,
    is_locked,
    new_token,
    password_policy_error,
    register_failed_login,
    register_successful_login,
    token_hash,
    verify_password,
    verify_password_timing_safe,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# IDが無いのか、パスワードが違うのかは区別して伝えない(IDの存在を探られないように)
_LOGIN_FAILED = "IDまたはパスワードが違います。"


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn) -> LoginOut:
    now = datetime.utcnow()
    user = store.find_user_by_login_id(body.login_id.strip())

    if user is not None and is_locked(user, now):
        raise HTTPException(
            status_code=429,
            detail="パスワードを続けて間違えたため、しばらくログインできません。時間をおいてお試しください。",
        )

    if not verify_password_timing_safe(body.password, user) or user is None:
        if user is not None:
            register_failed_login(user, now)
            store.save_user(user)
        raise HTTPException(status_code=401, detail=_LOGIN_FAILED)

    if not user.is_active:
        raise HTTPException(status_code=401, detail=_LOGIN_FAILED)

    register_successful_login(user)
    store.save_user(user)
    token = new_token()
    store.save_auth_session(AuthSession(token_hash=token_hash(token), user_id=user.id))
    return LoginOut(
        token=token,
        user=UserPublic.from_user(user),
        idle_timeout_minutes=get_settings().session_idle_minutes,
    )


@router.post("/logout")
def logout(token: str | None = Depends(current_token)) -> dict:
    if token:
        store.delete_auth_session(token_hash(token))
    return {"ok": True}


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(current_user_allow_password_change)) -> UserPublic:
    return UserPublic.from_user(user)


@router.post("/change-password", response_model=UserPublic)
def change_password(
    body: ChangePasswordIn,
    user: User = Depends(current_user_allow_password_change),
    token: str | None = Depends(current_token),
) -> UserPublic:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="今のパスワードが違います。")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="今と違うパスワードにしてください。")
    error = password_policy_error(body.new_password)
    if error:
        raise HTTPException(status_code=400, detail=error)

    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    store.save_user(user)
    # 他の端末に残っているログインは切り、今使っている端末だけ続けて使えるようにする
    current = store.get_auth_session(token_hash(token)) if token else None
    store.delete_auth_sessions_for_user(user.id)
    if current is not None:
        store.save_auth_session(current)
    return UserPublic.from_user(user)
