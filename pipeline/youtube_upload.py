"""YouTube Data API v3 を使った Shorts 自動投稿。

初回のみブラウザでのOAuth同意が必要(client_secrets.json)。
以降は token.json にリフレッシュトークンがキャッシュされ、完全非対話で実行できる。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from .utils import PipelineError, ffprobe_dimensions, ffprobe_duration_sec

logger = logging.getLogger("shorts_pipeline.youtube")

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def _validate_shorts_eligibility(video_path: Path) -> None:
    width, height = ffprobe_dimensions(video_path)
    duration = ffprobe_duration_sec(video_path)
    if width >= height:
        raise PipelineError(
            f"YouTube Shortsとして投稿するには縦型(9:16)動画が必要です (現在: {width}x{height})"
        )
    if duration > 60:
        raise PipelineError(
            f"YouTube Shortsは60秒以内である必要があります (現在: {duration:.1f}秒)"
        )


def _get_credentials(client_secrets_path: Path, token_path: Path) -> Credentials:
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not client_secrets_path.exists():
                raise PipelineError(
                    f"YouTube OAuthクライアントシークレットが見つかりません: {client_secrets_path}\n"
                    "Google Cloud Consoleで「デスクトップアプリ」のOAuthクライアントを作成し、"
                    "ダウンロードしたJSONをこのパスに配置してください。"
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets_path), SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")

    return creds


def upload(video_path: Path, config: dict) -> str:
    _validate_shorts_eligibility(video_path)

    yt_cfg = config.get("youtube", {})
    client_secrets_path = Path(os.environ.get("YOUTUBE_CLIENT_SECRETS_FILE", "client_secrets.json"))
    token_path = Path(os.environ.get("YOUTUBE_TOKEN_FILE", "token.json"))

    creds = _get_credentials(client_secrets_path, token_path)
    youtube = build("youtube", "v3", credentials=creds)

    title = yt_cfg.get("title", "Shorts")[:100]
    description = yt_cfg.get("description", "")
    if "#shorts" not in description.lower():
        description = description.rstrip() + "\n\n#Shorts"

    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": list(yt_cfg.get("tags", [])),
            "categoryId": str(yt_cfg.get("category_id", "24")),
        },
        "status": {
            "privacyStatus": yt_cfg.get("privacy_status", "private"),
            "selfDeclaredMadeForKids": bool(yt_cfg.get("made_for_kids", False)),
        },
    }
    media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True, mimetype="video/mp4")
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    logger.info("YouTubeへアップロード中...")
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            logger.info("アップロード進捗: %d%%", int(status.progress() * 100))

    video_id = response["id"]
    url = f"https://youtube.com/shorts/{video_id}"
    logger.info("アップロード完了: %s", url)
    return url
