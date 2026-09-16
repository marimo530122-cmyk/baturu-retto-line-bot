#!/usr/bin/env python3
"""Turn a daily-log entry (or raw script text) into a vertical short-form video (MP4).

Engine: edge-tts (free neural TTS with word-boundary timestamps) + ffmpeg/libass
(burned-in captions). No paid API keys, no external "shorts generator" framework -
just the same building blocks those frameworks wrap, composed directly.

Usage:
    python scripts/generate_short_video.py --log docs/daily-logs/2026-09-16-...md
    python scripts/generate_short_video.py --script "今日は..." --title "今日も修羅場"
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import os
import re
import subprocess
import sys
from dataclasses import dataclass

import edge_tts

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(REPO_ROOT, "output")

VOICE = os.environ.get("VOICE", "ja-JP-KeitaNeural")
MAX_NARRATION_CHARS = int(os.environ.get("MAX_NARRATION_CHARS", "160"))
WIDTH, HEIGHT = 1080, 1920
BG_COLOR_0 = os.environ.get("BG_COLOR_0", "0x1b2735")
BG_COLOR_1 = os.environ.get("BG_COLOR_1", "0x2c3e50")
MAX_CAPTION_CHARS = int(os.environ.get("MAX_CAPTION_CHARS", "14"))


@dataclass
class Cue:
    start: datetime.timedelta
    end: datetime.timedelta
    text: str


def extract_from_log(path: str) -> tuple[str, str]:
    """Pull a hook title and a short spoken narration out of a daily-log Markdown file."""
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    title_match = re.search(r"^# (.+)$", content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else os.path.basename(path)

    section_match = re.search(
        r"## ② 一次情報ドキュメント.*?\n(.*?)(?=\n## ③|\Z)", content, re.DOTALL
    )
    raw_section = section_match.group(1) if section_match else content
    raw_section = re.sub(r"^#### .+$", "", raw_section, flags=re.MULTILINE)
    narration = re.sub(r"\s+", "", raw_section).strip()

    if len(narration) > MAX_NARRATION_CHARS:
        cutoff = narration.rfind("。", 0, MAX_NARRATION_CHARS)
        narration = narration[: cutoff + 1] if cutoff != -1 else narration[:MAX_NARRATION_CHARS]

    return title, narration


async def synthesize(text: str, voice: str, audio_path: str) -> list[Cue]:
    communicate = edge_tts.Communicate(text, voice)
    cues: list[Cue] = []
    with open(audio_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                cues.append(
                    Cue(
                        start=datetime.timedelta(microseconds=chunk["offset"] / 10),
                        end=datetime.timedelta(
                            microseconds=(chunk["offset"] + chunk["duration"]) / 10
                        ),
                        text=chunk["text"],
                    )
                )
    return cues


def group_cues(cues: list[Cue], max_chars: int = MAX_CAPTION_CHARS) -> list[Cue]:
    """Merge word-level cues into short reading-friendly caption lines."""
    groups: list[Cue] = []
    current: list[Cue] = []
    current_len = 0
    for cue in cues:
        if current and current_len + len(cue.text) > max_chars:
            groups.append(
                Cue(start=current[0].start, end=current[-1].end, text="".join(c.text for c in current))
            )
            current = []
            current_len = 0
        current.append(cue)
        current_len += len(cue.text)
    if current:
        groups.append(
            Cue(start=current[0].start, end=current[-1].end, text="".join(c.text for c in current))
        )
    return groups


def format_ass_time(td: datetime.timedelta) -> str:
    total_cs = int(td.total_seconds() * 100)
    hours, rem = divmod(total_cs, 360000)
    minutes, rem = divmod(rem, 6000)
    seconds, centis = divmod(rem, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centis:02d}"


ASS_HEADER = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Noto Sans CJK JP,78,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,5,2,2,60,60,320,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def write_ass(cues: list[Cue], path: str) -> None:
    lines = [ASS_HEADER]
    for cue in group_cues(cues):
        text = cue.text.replace("\n", " ")
        lines.append(
            f"Dialogue: 0,{format_ass_time(cue.start)},{format_ass_time(cue.end)},Caption,,0,0,0,,{text}\n"
        )
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def probe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


def render_video(audio_path: str, ass_path: str, output_path: str, background: str | None) -> None:
    duration = probe_duration(audio_path)

    if background:
        bg_input = ["-stream_loop", "-1", "-i", background]
    else:
        gradient = (
            f"gradients=s={WIDTH}x{HEIGHT}:c0={BG_COLOR_0}:c1={BG_COLOR_1}"
            f":x0=0:y0=0:x1=0:y1={HEIGHT}"
        )
        bg_input = ["-f", "lavfi", "-i", gradient]

    cmd = [
        "ffmpeg",
        "-y",
        *bg_input,
        "-i",
        audio_path,
        "-filter_complex",
        f"[0:v]scale={WIDTH}:{HEIGHT},setsar=1,ass={ass_path}[v]",
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-t",
        str(duration),
        "-r",
        "30",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-shortest",
        output_path,
    ]
    subprocess.run(cmd, check=True)


def slugify(title: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^\w\-]+", "-", title, flags=re.UNICODE).strip("-")
    return slug[:max_len] if slug else "video"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", help="docs/daily-logs/*.md へのパス。ここからタイトルとナレーションを抽出する")
    parser.add_argument("--script", help="ナレーション文を直接指定する(--logより優先)")
    parser.add_argument("--title", help="動画タイトル(未指定なら--logの見出し、または先頭文字列を使用)")
    parser.add_argument("--voice", default=VOICE, help=f"edge-ttsの音声ID(デフォルト: {VOICE})")
    parser.add_argument("--background", help="背景に使う画像/動画ファイルのパス(未指定ならグラデーション背景を生成)")
    parser.add_argument("--output", help="出力MP4のパス")
    args = parser.parse_args()

    if args.script:
        narration = args.script
        title = args.title or narration[:20]
    elif args.log:
        title, narration = extract_from_log(args.log)
        title = args.title or title
    else:
        raise SystemExit("--log または --script のいずれかを指定してください。")

    if not narration:
        raise SystemExit("ナレーション文が空です。")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.datetime.now(datetime.timezone.utc)
    slug = slugify(title)
    audio_path = os.path.join(OUTPUT_DIR, f"{slug}.mp3")
    ass_path = os.path.join(OUTPUT_DIR, f"{slug}.ass")
    output_path = args.output or os.path.join(
        OUTPUT_DIR, f"{timestamp.strftime('%Y-%m-%d-%H%M%S')}-{slug}.mp4"
    )

    print(f"[1/3] TTS synthesis ({args.voice})...")
    cues = asyncio.run(synthesize(narration, args.voice, audio_path))

    print("[2/3] Building captions...")
    write_ass(cues, ass_path)

    print("[3/3] Rendering video with ffmpeg...")
    render_video(audio_path, ass_path, output_path, args.background)

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
