"""ステップ2b: ローカル画像素材によるビジュアル調達(無料・完全オフライン、画像生成AIは不使用)。

`assets/scenes/` (config.visuals.local_assets.dir で変更可)に、
あらかじめホラー風の背景画像(フリー素材・自作イラスト・自分で撮影した写真など、
著作権上問題のないもの)を配置しておくこと。

各シーンの画像は以下の優先順で決定する:
  1. config.json の scenes[i].image にファイル名が指定されていれば、それを使用
  2. 指定がなければ、フォルダ内の画像ファイルをファイル名順でシーンへ巡回割り当てする
"""
from __future__ import annotations

import logging
from pathlib import Path

from .timeline import SceneScript
from .utils import PipelineError

logger = logging.getLogger("shorts_pipeline.visuals.local")

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def generate_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    local_cfg = config.get("visuals", {}).get("local_assets", {})
    assets_dir = Path(local_cfg.get("dir", "assets/scenes"))

    if not assets_dir.exists():
        raise PipelineError(
            f"ローカル画像素材フォルダが見つかりません: {assets_dir}\n"
            "ホラー風の背景画像(png/jpg/webp)を配置してから再実行してください。"
        )

    available = sorted(
        p for p in assets_dir.iterdir() if p.is_file() and p.suffix.lower() in _IMAGE_EXTS
    )
    if not available:
        raise PipelineError(
            f"{assets_dir} に画像ファイル(png/jpg/webp)が1つも見つかりません。"
            "ホラー風の背景画像を配置してから再実行してください。"
        )

    by_name = {p.name: p for p in available}

    for i, scene in enumerate(scenes):
        if scene.image_hint:
            chosen = by_name.get(scene.image_hint)
            if chosen is None:
                raise PipelineError(
                    f"[{scene.id}] scenes[].image で指定された画像が見つかりません: "
                    f"{assets_dir / scene.image_hint}"
                )
        else:
            chosen = available[i % len(available)]

        logger.info("[%s] ローカル画像素材を使用: %s", scene.id, chosen.name)
        scene.image_path = str(chosen)
