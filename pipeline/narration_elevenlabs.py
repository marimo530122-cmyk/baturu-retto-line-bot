"""ステップ2a: ElevenLabsによるホラーナレーション音声合成。

`with-timestamps` エンドポイントを使い、文字単位のアライメント(発話タイミング)を
取得する。この実測タイムスタンプをそのまま
  - シーン動画クリップの長さ(zoompanのdフレーム数)
  - 字幕(.ass)の表示区間
の両方の基準にすることで、音声・映像・字幕が1フレームもズレずに同期する。
"""
from __future__ import annotations

import base64
import json
import logging
from pathlib import Path

import requests

from .timeline import SceneScript
from .utils import PipelineError, content_hash, ffprobe_duration_sec, require_env

logger = logging.getLogger("shorts_pipeline.narration")

_API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"

_BREAK_CHARS = set("。、！？!?\n」』…")


def synthesize_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    require_env("ELEVENLABS_API_KEY")
    el_cfg = config.get("narration", {}).get("elevenlabs", {})
    voice_id = el_cfg.get("voice_id")
    if not voice_id:
        raise PipelineError(
            "config.json の narration.elevenlabs.voice_id が未設定です "
            "(ELEVENLABS_VOICE_ID を .env に設定するか、config.json に直接記入してください)"
        )

    audio_dir = cache_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    sub_cfg = config.get("subtitles", {})
    max_chars = int(sub_cfg.get("max_chars_per_cue", 14))
    max_cue_duration = float(sub_cfg.get("max_cue_duration_sec", 3.2))

    cumulative = 0.0
    for scene in scenes:
        _synthesize_scene(scene, voice_id, el_cfg, audio_dir, max_chars, max_cue_duration)
        scene.start_sec = cumulative
        cumulative += scene.duration_sec
        for cue in scene.cues:
            cue["start"] += scene.start_sec
            cue["end"] += scene.start_sec

    total = cumulative
    logger.info("ナレーション音声生成完了: 合計 %.2f 秒 (%d シーン)", total, len(scenes))


def _synthesize_scene(
    scene: SceneScript,
    voice_id: str,
    el_cfg: dict,
    audio_dir: Path,
    max_chars: int,
    max_cue_duration: float,
) -> None:
    import os

    api_key = os.environ["ELEVENLABS_API_KEY"]
    model_id = el_cfg.get("model_id", "eleven_multilingual_v2")
    voice_settings = el_cfg.get("voice_settings", {})
    output_format = el_cfg.get("output_format", "mp3_44100_128")

    cache_key = content_hash(voice_id, model_id, scene.narration, json.dumps(voice_settings, sort_keys=True))
    audio_path = audio_dir / f"{scene.id}_{cache_key}.mp3"
    meta_path = audio_dir / f"{scene.id}_{cache_key}.json"

    if audio_path.exists() and meta_path.exists():
        logger.info("[%s] キャッシュ済みナレーションを使用: %s", scene.id, audio_path.name)
        alignment = json.loads(meta_path.read_text(encoding="utf-8"))
    else:
        logger.info("[%s] ElevenLabsでナレーション生成中...", scene.id)
        resp = requests.post(
            _API_URL.format(voice_id=voice_id),
            params={"output_format": output_format},
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={
                "text": scene.narration,
                "model_id": model_id,
                "voice_settings": voice_settings,
            },
            timeout=120,
        )
        if resp.status_code != 200:
            raise PipelineError(
                f"[{scene.id}] ElevenLabs API エラー ({resp.status_code}): {resp.text[:2000]}"
            )
        payload = resp.json()
        audio_bytes = base64.b64decode(payload["audio_base64"])
        audio_path.write_bytes(audio_bytes)

        alignment = payload.get("normalized_alignment") or payload["alignment"]
        meta_path.write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")

    scene.audio_path = str(audio_path)
    scene.duration_sec = ffprobe_duration_sec(audio_path)
    scene.cues = _build_cues(alignment, max_chars, max_cue_duration)


def _build_cues(alignment: dict, max_chars: int, max_cue_duration: float) -> list[dict]:
    chars = alignment.get("characters", [])
    starts = alignment.get("character_start_times_seconds", [])
    ends = alignment.get("character_end_times_seconds", [])
    if not chars or len(chars) != len(starts) or len(chars) != len(ends):
        return []

    cues: list[dict] = []
    buf: list[str] = []
    buf_start: float | None = None

    def flush(end_time: float) -> None:
        nonlocal buf, buf_start
        text = "".join(buf).strip()
        if text and buf_start is not None:
            cues.append({"start": buf_start, "end": end_time, "text": text})
        buf = []
        buf_start = None

    for ch, s, e in zip(chars, starts, ends):
        if buf_start is None:
            buf_start = s
        buf.append(ch)
        duration = e - buf_start
        is_break = ch in _BREAK_CHARS
        if (len(buf) >= max_chars and is_break) or len(buf) >= int(max_chars * 1.6) or duration >= max_cue_duration:
            flush(e)

    if buf:
        flush(ends[-1] if ends else (buf_start or 0.0))

    return cues
