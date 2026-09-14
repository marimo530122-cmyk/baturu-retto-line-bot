"""ステップ2a: pyttsx3(完全オフライン、外部サーバー不要)によるナレーション合成。

Linux環境では内部的に espeak-ng を利用する(`apt-get install espeak-ng` が必要)。
VOICEVOXのような自然な抑揚は得られず機械的な声質になるが、
サーバーの起動が不要で最小構成・ネットワーク接続ゼロで完結する。
ホラーの雰囲気を重視するなら narration.provider は "voicevox" を推奨。
"""
from __future__ import annotations

import logging
from pathlib import Path

from .subtitle_timing import split_cues_proportional
from .timeline import SceneScript
from .utils import PipelineError, content_hash, ffprobe_duration_sec, require_binaries

logger = logging.getLogger("shorts_pipeline.narration.pyttsx3")


def synthesize_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    require_binaries("espeak-ng")
    try:
        import pyttsx3
    except ImportError as e:
        raise PipelineError("pyttsx3 がインストールされていません: pip install pyttsx3") from e

    pt_cfg = config.get("narration", {}).get("pyttsx3", {})
    rate = int(pt_cfg.get("rate", 150))
    voice_substring = pt_cfg.get("voice_substring", "japan")

    sub_cfg = config.get("subtitles", {})
    max_chars = int(sub_cfg.get("max_chars_per_cue", 14))
    max_cue_duration = float(sub_cfg.get("max_cue_duration_sec", 3.2))

    audio_dir = cache_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    engine = pyttsx3.init()
    engine.setProperty("rate", rate)
    for voice in engine.getProperty("voices"):
        haystack = f"{voice.id} {voice.name}".lower()
        if voice_substring.lower() in haystack:
            engine.setProperty("voice", voice.id)
            break
    else:
        logger.warning(
            "voice_substring='%s' に一致する音声が見つかりませんでした。デフォルト音声を使用します。",
            voice_substring,
        )

    cumulative = 0.0
    for scene in scenes:
        cache_key = content_hash(scene.narration, str(rate), voice_substring)
        audio_path = audio_dir / f"{scene.id}_{cache_key}.wav"

        if audio_path.exists():
            logger.info("[%s] キャッシュ済みナレーションを使用: %s", scene.id, audio_path.name)
        else:
            logger.info("[%s] pyttsx3でナレーション生成中...", scene.id)
            engine.save_to_file(scene.narration, str(audio_path))
            engine.runAndWait()
            # pyttsx3のespeakドライバは、runAndWait()後にstop()を呼ばないと
            # 長めのテキストでファイル書き込みが完了しないことがある(既知の癖)。
            engine.stop()
            if not audio_path.exists() or audio_path.stat().st_size == 0:
                raise PipelineError(f"[{scene.id}] pyttsx3が音声ファイルを生成できませんでした")

        scene.audio_path = str(audio_path)
        scene.duration_sec = ffprobe_duration_sec(audio_path)
        scene.start_sec = cumulative

        cues = split_cues_proportional(scene.narration, scene.duration_sec, max_chars, max_cue_duration)
        for cue in cues:
            cue["start"] += scene.start_sec
            cue["end"] += scene.start_sec
        scene.cues = cues

        cumulative += scene.duration_sec

    logger.info("ナレーション音声生成完了(pyttsx3): 合計 %.2f 秒 (%d シーン)", cumulative, len(scenes))
