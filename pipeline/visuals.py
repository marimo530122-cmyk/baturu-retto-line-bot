"""ステップ2b: ビジュアル調達のディスパッチャ。

config.visuals.provider で切り替える:
  - "local_assets" (デフォルト・推奨): 無料。事前に用意した画像素材を使用、画像生成AIは不使用
  - "stability": 有料クラウドAPI(Stability AI)。要APIキー
"""
from __future__ import annotations

from pathlib import Path

from .timeline import SceneScript
from .utils import PipelineError


def generate_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    provider = config.get("visuals", {}).get("provider", "local_assets")

    if provider == "local_assets":
        from . import visuals_local

        visuals_local.generate_all(scenes, config, cache_dir)
    elif provider == "stability":
        from . import visuals_stability

        visuals_stability.generate_all(scenes, config, cache_dir)
    else:
        raise PipelineError(
            f"未知の visuals.provider: '{provider}' (local_assets / stability のいずれかを指定)"
        )
