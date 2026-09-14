"""ステップ1: テキスト解析・シーン分割。

config.json の `scenes`(手動指定)または `novel_text`(自動分割)から、
ホラー演出のタメとフックを考慮したシーン台本(SceneScript)のリストを作る。

このステップではまだ「秒数」は確定しない(まだ音声を生成していないため)。
実際の尺は narration.py でElevenLabsから返る音声の実測時間を使って確定させ、
フレーム単位のズレが出ないようにする。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .utils import PipelineError

CAMERA_CYCLE = ["zoom_in", "pan_right", "zoom_out", "pan_left"]

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?])|\n+")


@dataclass
class SceneScript:
    id: str
    index: int
    narration: str
    visual_prompt: str
    camera: str
    # 実測値。narration.py がTTS生成後に埋める。
    audio_path: str | None = field(default=None, repr=False)
    duration_sec: float | None = field(default=None, repr=False)
    start_sec: float | None = field(default=None, repr=False)
    cues: list = field(default_factory=list, repr=False)
    # visuals.py が画像生成後に埋める。
    image_path: str | None = field(default=None, repr=False)


def build_scene_scripts(config: dict) -> list[SceneScript]:
    explicit = config.get("scenes") or []
    if explicit:
        return _from_explicit_scenes(explicit, config)

    novel_text = (config.get("novel_text") or "").strip()
    if not novel_text:
        raise PipelineError(
            "config.json に novel_text または scenes のどちらも指定されていません。"
            "小説『おかしなAIたち』の本文を novel_text に貼り付けるか、"
            "scenes 配列でシーンごとのナレーションを指定してください。"
        )
    return _auto_split(novel_text, config)


def _from_explicit_scenes(explicit: list[dict], config: dict) -> list[SceneScript]:
    scenes = []
    for i, raw in enumerate(explicit):
        narration = (raw.get("narration") or "").strip()
        if not narration:
            raise PipelineError(f"scenes[{i}] に narration がありません")
        scene_id = raw.get("id") or f"scene_{i + 1}"
        visual_prompt = raw.get("visual_prompt") or _default_visual_prompt(narration, config)
        camera = raw.get("camera") or CAMERA_CYCLE[i % len(CAMERA_CYCLE)]
        scenes.append(
            SceneScript(id=scene_id, index=i, narration=narration, visual_prompt=visual_prompt, camera=camera)
        )
    return scenes


def _auto_split(novel_text: str, config: dict) -> list[SceneScript]:
    target_duration = float(config.get("project", {}).get("target_duration_sec", 45))
    # ホラー演出上、1シーンあたり平均5〜7秒程度が「タメ」を作りやすい目安。
    approx_scene_len_sec = 6.0
    num_scenes = max(4, min(10, round(target_duration / approx_scene_len_sec)))

    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(novel_text) if s.strip()]
    if not sentences:
        raise PipelineError("novel_text からシーンを抽出できませんでした")

    total_len = sum(len(s) for s in sentences)
    budget = max(1, total_len / num_scenes)

    grouped: list[list[str]] = []
    current: list[str] = []
    current_len = 0
    for sentence in sentences:
        current.append(sentence)
        current_len += len(sentence)
        if current_len >= budget and len(grouped) < num_scenes - 1:
            grouped.append(current)
            current = []
            current_len = 0
    if current:
        grouped.append(current)

    scenes = []
    for i, group in enumerate(grouped):
        narration = "".join(group)
        scene_id = f"scene_{i + 1}"
        camera = CAMERA_CYCLE[i % len(CAMERA_CYCLE)]
        visual_prompt = _default_visual_prompt(narration, config)
        scenes.append(
            SceneScript(id=scene_id, index=i, narration=narration, visual_prompt=visual_prompt, camera=camera)
        )
    return scenes


def _default_visual_prompt(narration: str, config: dict) -> str:
    style = config.get("style", {}).get("visual_style", "")
    characters = config.get("characters", [])
    mentioned = [
        c["visual_description"]
        for c in characters
        if c.get("name") and c["name"] in narration and c.get("visual_description")
        and not c["visual_description"].startswith("TODO")
    ]
    parts = [style] + mentioned + [f"scene depicting: {narration}"]
    return ", ".join(p for p in parts if p)
