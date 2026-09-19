#!/usr/bin/env python3
"""Gemini (Veo) API を使って動画を生成し、base_video.mp4 として保存するスクリプト。

使い方:
    export GEMINI_API_KEY="your-api-key"
    python3 make_video.py
"""

import os
import sys
import time

from google import genai
from google.genai import types

MODEL_NAME = "veo-3.1-generate-001"
PROMPT = (
    "A futuristic cyberpunk robot speaking in a bustling night city, "
    "9:16 aspect ratio"
)
ASPECT_RATIO = "9:16"
DURATION_SECONDS = 8
POLL_INTERVAL_SECONDS = 10
OUTPUT_PATH = "base_video.mp4"


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("エラー: 環境変数 GEMINI_API_KEY が設定されていません。", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    print(f"動画生成を開始します(model={MODEL_NAME})...")
    operation = client.models.generate_videos(
        model=MODEL_NAME,
        prompt=PROMPT,
        config=types.GenerateVideosConfig(
            aspect_ratio=ASPECT_RATIO,
            duration_seconds=DURATION_SECONDS,
        ),
    )

    while not operation.done:
        print(f"生成中... {POLL_INTERVAL_SECONDS}秒後に再確認します。")
        time.sleep(POLL_INTERVAL_SECONDS)
        operation = client.operations.get(operation)

    if operation.error:
        print(f"エラー: 動画生成に失敗しました: {operation.error}", file=sys.stderr)
        sys.exit(1)

    generated_videos = operation.response.generated_videos
    if not generated_videos:
        print("エラー: 動画が生成されませんでした。", file=sys.stderr)
        sys.exit(1)

    video = generated_videos[0].video
    client.files.download(file=video, destination=OUTPUT_PATH)

    print(f"完了しました。動画を保存しました: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
