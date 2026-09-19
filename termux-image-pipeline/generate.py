#!/usr/bin/env python3
"""
Termux向け 自律型画像生成パイプライン
プロンプトを渡すだけで16:9画像を生成し、内部保存 + (実機なら)スマホ共有フォルダへ保存する。

採用エンジン: Pollinations.ai (https://pollinations.ai)
  - APIキー不要、無料、GETリクエスト1本で完結
  - width/height指定で16:9を厳密に出せる
  - ローカルに重いモデルを持たないのでTermuxのRAM/ストレージを圧迫しない
  - 多くのOSS画像生成ラッパーが裏で使っている枯れたエンドポイント

依存: 標準ライブラリのみ(urllib)で動作。requestsは不要。
"""
import argparse
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NOTE_PROJECT_DIR = os.path.expanduser("~/note_project")
INTERNAL_IMAGE_DIR = os.path.join(NOTE_PROJECT_DIR, "images")
SHARED_STORAGE_ROOT = os.path.expanduser("~/storage/shared")
SHARED_DOWNLOAD_DIR = os.path.join(SHARED_STORAGE_ROOT, "Download", "note_images")

POLLINATIONS_BASE = "https://image.pollinations.ai/prompt/"
WIDTH, HEIGHT = 1920, 1080  # 16:9


def slugify(text: str, max_len: int = 40) -> str:
    chars = [c if c.isalnum() else "-" for c in text]
    slug = "".join(chars).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:max_len] or "image"


def generate_image(prompt: str, seed: int | None = None, timeout: int = 60) -> bytes:
    encoded_prompt = urllib.parse.quote(prompt, safe="")
    params = {"width": WIDTH, "height": HEIGHT, "nologo": "true"}
    if seed is not None:
        params["seed"] = seed
    url = f"{POLLINATIONS_BASE}{encoded_prompt}?{urllib.parse.urlencode(params)}"

    req = urllib.request.Request(url, headers={"User-Agent": "note-project-image-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def save_image(data: bytes, prompt: str) -> str:
    os.makedirs(INTERNAL_IMAGE_DIR, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    filename = f"{timestamp}-{slugify(prompt)}.jpg"

    internal_path = os.path.join(INTERNAL_IMAGE_DIR, filename)
    with open(internal_path, "wb") as f:
        f.write(data)
    print(f"[OK] 内部保存: {internal_path}")

    if os.path.isdir(SHARED_STORAGE_ROOT):
        os.makedirs(SHARED_DOWNLOAD_DIR, exist_ok=True)
        shared_path = os.path.join(SHARED_DOWNLOAD_DIR, filename)
        shutil.copy2(internal_path, shared_path)
        print(f"[OK] スマホ共有フォルダへコピー: {shared_path}")
    else:
        print(
            "[SKIP] ~/storage/shared が見つかりません。"
            "Termux実機で `pkg install termux-api && termux-setup-storage` を"
            "実行するとギャラリー共有フォルダへも自動保存されます。"
        )

    return internal_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="プロンプトから16:9画像を生成し、note_project/images に保存する"
    )
    parser.add_argument("prompt", help="生成したい画像の説明文")
    parser.add_argument("--seed", type=int, default=None, help="再現性のためのシード値(任意)")
    args = parser.parse_args()

    print(f"[..] 生成中: {args.prompt}")
    try:
        data = generate_image(args.prompt, seed=args.seed)
    except urllib.error.URLError as e:
        print(f"[NG] 画像生成APIへの接続に失敗しました: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:  # noqa: BLE001
        print(f"[NG] 画像生成に失敗しました: {e}", file=sys.stderr)
        sys.exit(1)

    save_image(data, args.prompt)


if __name__ == "__main__":
    main()
