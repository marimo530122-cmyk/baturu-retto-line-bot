"""ステップ3: 字幕(.ass)の生成。

ElevenLabsの文字単位アライメントから作られた `scene.cues` を、
libass経由でffmpegが焼き込める .ass ファイルに変換する。
手書きの図形描画やPillowでの雑なテキスト合成は行わず、
プロの字幕制作でも使われるASS(Advanced SubStation Alpha)形式でスタイリングする。
"""
from __future__ import annotations

from pathlib import Path

from .timeline import SceneScript


def _format_ts(seconds: float) -> str:
    seconds = max(0.0, seconds)
    total_cs = round(seconds * 100)
    cs = total_cs % 100
    total_s = total_cs // 100
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def generate_ass(scenes: list[SceneScript], config: dict, output_path: Path) -> Path:
    sub_cfg = config.get("subtitles", {})
    video_cfg = config.get("project", {}).get("video", {})
    width = int(video_cfg.get("width", 1080))
    height = int(video_cfg.get("height", 1920))

    font_name = sub_cfg.get("font_name", "Noto Sans JP Black")
    font_size = int(sub_cfg.get("font_size", 78))
    primary_color = sub_cfg.get("primary_color", "&H00FFFFFF")
    outline_color = sub_cfg.get("outline_color", "&H00050514")
    back_color = sub_cfg.get("back_color", "&H960B0B0B")
    outline_width = float(sub_cfg.get("outline_width", 3.2))
    shadow = float(sub_cfg.get("shadow", 1.5))
    margin_v = int(sub_cfg.get("margin_v", 180))

    header = f"""[Script Info]
Title: Horror Shorts Subtitles
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Horror,{font_name},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},-1,0,0,0,100,100,0,0,1,{outline_width},{shadow},2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines = [header]
    for scene in scenes:
        for cue in scene.cues:
            start = _format_ts(cue["start"])
            end = _format_ts(cue["end"])
            text = cue["text"].replace("\n", "\\N")
            lines.append(f"Dialogue: 0,{start},{end},Horror,,0,0,0,,{text}\n")

    output_path.write_text("".join(lines), encoding="utf-8")
    return output_path
