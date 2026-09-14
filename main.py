#!/usr/bin/env python3
"""小説『おかしなAIたち』ホラーShorts自動生成パイプライン。

実行例:
    python main.py --config config.json
    python main.py --config config.json --upload      # 生成後にYouTube Shortsへ自動投稿
    python main.py --config config.json --no-upload    # config.youtube.auto_upload=true でもアップロードしない

必要な環境変数 (.env に設定 / .env.example 参照):
    STABILITY_API_KEY        Stability AI (背景/キャラクター画像生成)
    ELEVENLABS_API_KEY       ElevenLabs (ホラーナレーション音声合成)
    ELEVENLABS_VOICE_ID      使用するElevenLabsボイスID
    YOUTUBE_CLIENT_SECRETS_FILE  (--upload時のみ) Google CloudのOAuthクライアントJSON
    YOUTUBE_TOKEN_FILE       (--upload時のみ) 認証トークンのキャッシュ先
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

from pipeline import narration, render, visuals, youtube_upload
from pipeline.timeline import build_scene_scripts
from pipeline.utils import PipelineError, load_config, setup_logging

logger = logging.getLogger("shorts_pipeline.main")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="小説→YouTube Shortsホラー動画 自動生成パイプライン")
    parser.add_argument("--config", default="config.json", help="設定ファイルのパス (デフォルト: config.json)")
    parser.add_argument("--upload", action="store_true", help="生成後にYouTube Shortsへ自動投稿する")
    parser.add_argument("--no-upload", action="store_true", help="config.jsonの設定に関わらずアップロードしない")
    parser.add_argument("--verbose", action="store_true", help="デバッグログを表示")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    setup_logging(args.verbose)
    load_dotenv()

    try:
        config = load_config(args.config)
        cache_dir = Path(config.get("project", {}).get("cache_dir", "cache"))
        cache_dir.mkdir(parents=True, exist_ok=True)

        logger.info("=== ステップ1: シーン分割 ===")
        scenes = build_scene_scripts(config)
        logger.info("シーン数: %d", len(scenes))
        for scene in scenes:
            logger.info("  [%s] (camera=%s) %s", scene.id, scene.camera, scene.narration[:40])

        logger.info("=== ステップ2a: ナレーション音声合成 (ElevenLabs) ===")
        narration.synthesize_all(scenes, config, cache_dir)

        logger.info("=== ステップ2b: ビジュアル自動生成 (Stability AI) ===")
        visuals.generate_all(scenes, config, cache_dir)

        logger.info("=== ステップ3-4: 字幕焼き込み・MP4レンダリング ===")
        output_path = render.render(scenes, config, cache_dir)

        should_upload = args.upload or (
            config.get("youtube", {}).get("auto_upload", False) and not args.no_upload
        )
        if should_upload:
            logger.info("=== ステップ5: YouTube Shortsへ自動投稿 ===")
            url = youtube_upload.upload(output_path, config)
            logger.info("公開URL: %s", url)
        else:
            logger.info("YouTubeへのアップロードはスキップしました (--upload で有効化できます)")

        logger.info("完了しました: %s", output_path.resolve())
        return 0

    except PipelineError as e:
        logger.error("パイプラインエラー: %s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
