"""ステップ2b: Stability AIによるキャラクター/背景ビジュアルの自動生成。

シーンごとに `stable-image/generate/{endpoint}` (デフォルト: core, 低コスト) を呼び出し、
9:16のホラービジュアルを生成してローカルキャッシュに保存する。
同一プロンプトは再利用され、余計なAPI課金を防ぐ。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import requests

from .timeline import SceneScript
from .utils import PipelineError, content_hash, require_env

logger = logging.getLogger("shorts_pipeline.visuals")

_API_URL = "https://api.stability.ai/v2beta/stable-image/generate/{endpoint}"


def generate_all(scenes: list[SceneScript], config: dict, cache_dir: Path) -> None:
    require_env("STABILITY_API_KEY")
    stability_cfg = config.get("visuals", {}).get("stability", {})
    style_cfg = config.get("style", {})

    images_dir = cache_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    for scene in scenes:
        _generate_scene_image(scene, stability_cfg, style_cfg, images_dir)


def _generate_scene_image(scene: SceneScript, stability_cfg: dict, style_cfg: dict, images_dir: Path) -> None:
    api_key = os.environ["STABILITY_API_KEY"]
    endpoint = stability_cfg.get("endpoint", "core")
    aspect_ratio = stability_cfg.get("aspect_ratio", "9:16")
    output_format = stability_cfg.get("output_format", "png")
    style_preset = style_cfg.get("style_preset")
    negative_prompt = style_cfg.get("negative_prompt", "")

    cache_key = content_hash(scene.visual_prompt, negative_prompt, endpoint, aspect_ratio, style_preset or "")
    image_path = images_dir / f"{scene.id}_{cache_key}.{output_format}"

    if image_path.exists():
        logger.info("[%s] キャッシュ済み画像を使用: %s", scene.id, image_path.name)
        scene.image_path = str(image_path)
        return

    logger.info("[%s] Stability AIで画像生成中...", scene.id)
    data = {
        "prompt": scene.visual_prompt,
        "negative_prompt": negative_prompt,
        "aspect_ratio": aspect_ratio,
        "output_format": output_format,
    }
    if style_preset:
        data["style_preset"] = style_preset

    resp = requests.post(
        _API_URL.format(endpoint=endpoint),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "image/*",
        },
        # Stability API はmultipart/form-dataを要求するため、
        # アップロードするファイルが無くても files= を渡してmultipartエンコードを強制する。
        files={"none": ""},
        data=data,
        timeout=120,
    )
    if resp.status_code != 200:
        raise PipelineError(
            f"[{scene.id}] Stability AI API エラー ({resp.status_code}): {resp.text[:2000]}"
        )

    image_path.write_bytes(resp.content)
    scene.image_path = str(image_path)
