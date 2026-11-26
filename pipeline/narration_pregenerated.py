"""ステップ2a: 事前に用意されたナレーション音声ファイルをそのまま使用する。

ユーザー側で別のTTS/読み上げ(例: Aria等)で作った音声ファイルを
assets/narration/episode_0N/scene_01.mp3 のように配置しておけば、
本パイプラインはそれをそのまま使用する(自前のTTS呼び出しは一切行わない)。

ElevenLabsのような文字単位の正確なアライメントは無いため、
字幕タイミングは subtitle_timing.py で文字数比に応じた近似配分を行う。
シーン単位の動画長は実測した音声長(ffprobe)と完全に一致する。
"""
from __future__ import annotations

import logging
from pathlib import Path

from .subtitle_timing import split_cues_proportional
from .timeline import SceneScript
from .utils import PipelineError, ffprobe_duration_sec

logger = logging.getLogger("shorts_pipeline.narration.pregenerated")


def synthesize_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    pg_cfg = config.get("narration", {}).get("pregenerated", {})
    dir_value = pg_cfg.get("dir")
    if not dir_value:
        raise PipelineError(
            "config.json の narration.pregenerated.dir が未設定です。"
            "ナレーション音声ファイルを置いたディレクトリを指定してください。"
        )
    audio_dir = Path(dir_value)
    if not audio_dir.exists():
        raise PipelineError(f"narration.pregenerated.dir が見つかりません: {audio_dir}")

    sub_cfg = config.get("subtitles", {})
    max_chars = int(sub_cfg.get("max_chars_per_cue", 12))
    max_cue_duration = float(sub_cfg.get("max_cue_duration_sec", 3.2))

    cumulative = 0.0
    for scene in scenes:
        filename = scene.audio_hint or f"scene_{scene.index + 1:02d}.mp3"
        audio_path = audio_dir / filename
        if not audio_path.exists():
            raise PipelineError(
                f"[{scene.id}] ナレーション音声ファイルが見つかりません: {audio_path}"
            )

        logger.info("[%s] 事前生成音声を使用: %s", scene.id, audio_path.name)
        scene.audio_path = str(audio_path)
        scene.duration_sec = ffprobe_duration_sec(audio_path)
        scene.start_sec = cumulative

        cues = split_cues_proportional(scene.narration, scene.duration_sec, max_chars, max_cue_duration)
        for cue in cues:
            cue["start"] += scene.start_sec
            cue["end"] += scene.start_sec
        scene.cues = cues

        cumulative += scene.duration_sec

    logger.info(
        "ナレーション音声読み込み完了(事前生成): 合計 %.2f 秒 (%d シーン)", cumulative, len(scenes)
    )
