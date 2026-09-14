"""ステップ2a: VOICEVOX Engine(無料・オープンソースのローカル日本語TTS)によるナレーション合成。

事前に VOICEVOX Engine を起動しておく必要がある:
  - デスクトップアプリ: https://voicevox.hiroshiba.jp/ からダウンロードして起動
  - もしくはDocker: docker run -d -p 50021:50021 voicevox/voicevox_engine:cpu-latest

話者ID(speaker_id)は起動したエンジンの `GET /speakers` で確認できる
(バージョンによって番号が変わるため、必ず自分の環境で確認すること)。

各キャラクターには個別の利用規約(動画公開時のクレジット表記義務など)があるため、
生成物を公開する場合は使用した話者の利用規約を必ず確認すること。

ElevenLabsの文字単位アライメントのような完全な精度は得られないため、
字幕タイミングは subtitle_timing.py で文字数比に応じて近似配分する
(シーン単位の音声長=動画長は実測値なので、そこは完全に一致する)。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import requests

from .subtitle_timing import split_cues_proportional
from .timeline import SceneScript
from .utils import PipelineError, content_hash, ffprobe_duration_sec

logger = logging.getLogger("shorts_pipeline.narration.voicevox")


def _host() -> str:
    return os.environ.get("VOICEVOX_HOST", "http://127.0.0.1:50021")


def _check_engine(host: str) -> None:
    try:
        resp = requests.get(f"{host}/version", timeout=5)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise PipelineError(
            f"VOICEVOX Engineに接続できません ({host}): {e}\n"
            "https://voicevox.hiroshiba.jp/ からダウンロードして起動するか、"
            "`docker run -d -p 50021:50021 voicevox/voicevox_engine:cpu-latest` を実行してください。"
        )


def synthesize_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    host = _host()
    _check_engine(host)

    vv_cfg = config.get("narration", {}).get("voicevox", {})
    speaker = int(vv_cfg.get("speaker_id", 2))
    speed_scale = float(vv_cfg.get("speed_scale", 0.95))
    pitch_scale = float(vv_cfg.get("pitch_scale", -0.02))
    intonation_scale = float(vv_cfg.get("intonation_scale", 1.3))

    sub_cfg = config.get("subtitles", {})
    max_chars = int(sub_cfg.get("max_chars_per_cue", 14))
    max_cue_duration = float(sub_cfg.get("max_cue_duration_sec", 3.2))

    audio_dir = cache_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    cumulative = 0.0
    for scene in scenes:
        cache_key = content_hash(
            str(speaker), scene.narration, f"{speed_scale}", f"{pitch_scale}", f"{intonation_scale}"
        )
        audio_path = audio_dir / f"{scene.id}_{cache_key}.wav"

        if audio_path.exists():
            logger.info("[%s] キャッシュ済みナレーションを使用: %s", scene.id, audio_path.name)
        else:
            logger.info("[%s] VOICEVOXでナレーション生成中 (speaker=%d)...", scene.id, speaker)
            query_resp = requests.post(
                f"{host}/audio_query",
                params={"text": scene.narration, "speaker": speaker},
                timeout=60,
            )
            if query_resp.status_code != 200:
                raise PipelineError(
                    f"[{scene.id}] VOICEVOX audio_query エラー ({query_resp.status_code}): "
                    f"{query_resp.text[:1000]}"
                )
            query = query_resp.json()
            query["speedScale"] = speed_scale
            query["pitchScale"] = pitch_scale
            query["intonationScale"] = intonation_scale

            synth_resp = requests.post(
                f"{host}/synthesis",
                params={"speaker": speaker},
                headers={"Content-Type": "application/json"},
                data=json.dumps(query),
                timeout=120,
            )
            if synth_resp.status_code != 200:
                raise PipelineError(
                    f"[{scene.id}] VOICEVOX synthesis エラー ({synth_resp.status_code}): "
                    f"{synth_resp.text[:1000]}"
                )
            audio_path.write_bytes(synth_resp.content)

        scene.audio_path = str(audio_path)
        scene.duration_sec = ffprobe_duration_sec(audio_path)
        scene.start_sec = cumulative

        cues = split_cues_proportional(scene.narration, scene.duration_sec, max_chars, max_cue_duration)
        for cue in cues:
            cue["start"] += scene.start_sec
            cue["end"] += scene.start_sec
        scene.cues = cues

        cumulative += scene.duration_sec

    logger.info("ナレーション音声生成完了(VOICEVOX): 合計 %.2f 秒 (%d シーン)", cumulative, len(scenes))
