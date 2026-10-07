"""最初の管理者アカウントを作るためのコマンド。

管理者が1人もいない状態では画面から職員を登録できないため、最初の1人だけはここで作る。
使い方(backend フォルダで):
    python -m app.cli create-admin
2人目以降の職員は、この管理者でログインして「職員管理」画面から登録する。
"""
from __future__ import annotations

import argparse
import getpass
import sys


def create_admin(login_id: str, display_name: str, password: str) -> str:
    from app.data import store
    from app.models import Role, User
    from app.services.auth import hash_password, password_policy_error

    if store.find_user_by_login_id(login_id):
        raise ValueError("そのログインIDはすでに使われています。")
    error = password_policy_error(password)
    if error:
        raise ValueError(error)
    user = User(
        login_id=login_id,
        display_name=display_name,
        role=Role.ADMIN,
        password_hash=hash_password(password),
        # 自分で決めたパスワードなので、初回ログイン時の変更は求めない
        must_change_password=False,
    )
    store.save_user(user)
    return user.id


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="医療AI 診察支援: 管理用コマンド")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("create-admin", help="管理者アカウントを作る")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        login_id = input("管理者のログインID: ").strip()
        display_name = input("表示名(例: 事務長 山田): ").strip() or login_id
        password = getpass.getpass("パスワード(10文字以上・英字と数字を含む): ")
        if password != getpass.getpass("もう一度パスワード: "):
            print("パスワードが一致しません。", file=sys.stderr)
            return 1
        try:
            create_admin(login_id, display_name, password)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(f"管理者「{display_name}」を作成しました。画面からログインできます。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
