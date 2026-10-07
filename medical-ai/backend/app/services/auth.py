"""パスワードの保存・照合と、ログイン状態(トークン)の管理。

- パスワードは scrypt(Python標準ライブラリ、追加費用・追加パッケージなし)でハッシュ化して保存し、
  元のパスワードはどこにも保存しない。
- ログイン状態はランダムなトークンで表し、DBにはトークンのSHA-256だけを保存する。
- 最後の操作から一定時間(既定30分)たつと、そのトークンは使えなくなる(自動ログアウト)。
- 同じIDで続けてパスワードを間違えると、しばらくロックする(総当たり対策)。
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from app.models import User

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1

MIN_PASSWORD_LENGTH = 10
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_hex, digest_hex = stored.split("$")
        if algo != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt_hex), n=int(n), r=int(r), p=int(p)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


# 存在しないIDでログインを試されたときも、同じくらい時間をかけて照合する
# (応答時間の差から「そのIDが存在するか」を推測されないようにするため)
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def verify_password_timing_safe(password: str, user: User | None) -> bool:
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return False
    return verify_password(password, user.password_hash)


def password_policy_error(password: str) -> str | None:
    """パスワードの決まりを満たしていなければ、その理由(画面にそのまま出せる日本語)を返す。"""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"パスワードは{MIN_PASSWORD_LENGTH}文字以上にしてください。"
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        return "パスワードには英字と数字の両方を入れてください。"
    return None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def is_locked(user: User, now: datetime) -> bool:
    return user.locked_until is not None and user.locked_until > now


def register_failed_login(user: User, now: datetime) -> None:
    user.failed_login_count += 1
    if user.failed_login_count >= MAX_FAILED_LOGINS:
        user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
        user.failed_login_count = 0


def register_successful_login(user: User) -> None:
    user.failed_login_count = 0
    user.locked_until = None
