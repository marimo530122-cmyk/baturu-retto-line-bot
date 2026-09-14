"""ステップ2a: ナレーション音声合成のディスパッチャ。

config.narration.provider で切り替える:
  - "voicevox" (デフォルト・推奨): 無料・オープンソースのローカルTTSエンジン
  - "pyttsx3": 完全オフライン、サーバー起動不要(品質は機械的)
  - "elevenlabs": 有料クラウドAPI。文字単位の正確なアライメント付き。要APIキー
"""
from __future__ import annotations

from pathlib import Path

from .timeline import SceneScript
from .utils import PipelineError


def synthesize_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    provider = config.get("narration", {}).get("provider", "voicevox")

    if provider == "voicevox":
        from . import narration_voicevox

        narration_voicevox.synthesize_all(scenes, config, cache_dir)
    elif provider == "pyttsx3":
        from . import narration_pyttsx3

        narration_pyttsx3.synthesize_all(scenes, config, cache_dir)
    elif provider == "elevenlabs":
        from . import narration_elevenlabs

        narration_elevenlabs.synthesize_all(scenes, config, cache_dir)
    else:
        raise PipelineError(
            f"未知の narration.provider: '{provider}' (voicevox / pyttsx3 / elevenlabs のいずれかを指定)"
        )
