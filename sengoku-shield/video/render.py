#!/usr/bin/env python3
"""操作手順動画の仕上げ: capture.js が作ったコマ画像に、ナレーション音声をつけて MP4 にする。

    python3 video/render.py [ep1 ep3 ...]          # 音声あり(edge-tts。ネットにつながる所で)
    python3 video/render.py --silent [ep1 ...]     # 音声なし(長さだけ合わせた確認用)

出力: video/out/<話>.mp4(縦 1080x1920)。
- 声は汎用の合成音声(edge-tts の日本語の女性の声)。本人や家族の声をまねる機能は使わない。
- 1コマ = ナレーション1つ。声の長さ + 前後の間 だけコマを出し続ける。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
VOICE = os.environ.get("VIDEO_VOICE", "ja-JP-NanamiNeural")
RATE = os.environ.get("VIDEO_RATE", "-8%")  # お年寄りにも聞き取りやすいよう、少しゆっくり
# 字幕はそのまま、読み上げだけ読み方を直す(合成音声が読み間違えやすい言葉)
READINGS = {
    "鮮刻シールド": "せんこくシールド",
    "110番": "ひゃくとおばん",
    "①": "いち",
    "②": "に",
}
LEAD_SEC = 0.4   # コマが出てから話し始めるまで
TAIL_SEC = 0.9   # 話し終わってから次のコマまで


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def duration(path: str) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
    return float(out.strip())


async def tts(text: str, path: str) -> None:
    import edge_tts

    for word, reading in READINGS.items():
        text = text.replace(word, reading)
    await edge_tts.Communicate(text, VOICE, rate=RATE).save(path)


def make_audio(text: str, path: str, silent: bool) -> float:
    """ナレーションの音声(前後の間つき)を wav で作り、長さを返す。"""
    raw = path + ".raw.mp3"
    if silent:
        speech_sec = max(2.0, len(text) * 0.16)  # 1文字0.16秒くらいで見積もる
        run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{speech_sec}", raw])
    else:
        asyncio.run(tts(text, raw))
    run([
        "ffmpeg", "-y", "-v", "error", "-i", raw,
        "-af", f"adelay={int(LEAD_SEC * 1000)},apad=pad_dur={TAIL_SEC}",
        "-ar", "48000", "-ac", "2", path,
    ])
    os.remove(raw)
    return duration(path)


def render_episode(ep_id: str, silent: bool) -> str:
    ep_dir = os.path.join(OUT, ep_id)
    with open(os.path.join(ep_dir, "scenes.json"), encoding="utf-8") as f:
        meta = json.load(f)

    parts = []
    for i, scene in enumerate(meta["scenes"]):
        audio = os.path.join(ep_dir, f"{i + 1:02d}.wav")
        sec = make_audio(scene["narration"], audio, silent)
        part = os.path.join(ep_dir, f"{i + 1:02d}.mp4")
        run([
            "ffmpeg", "-y", "-v", "error",
            "-loop", "1", "-framerate", "30", "-i", os.path.join(ep_dir, scene["image"]),
            "-i", audio,
            "-t", f"{sec:.3f}",
            "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            part,
        ])
        parts.append(part)
        print(f"[{ep_id}] {i + 1:02d} {sec:.1f}秒 {scene['heading']}")

    listing = os.path.join(ep_dir, "parts.txt")
    with open(listing, "w", encoding="utf-8") as f:
        f.writelines(f"file '{os.path.basename(p)}'\n" for p in parts)
    out = os.path.join(OUT, f"{ep_id}.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", "-movflags", "+faststart", out])
    print(f"[{ep_id}] できあがり: {out}({duration(out):.0f}秒)")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("episodes", nargs="*")
    ap.add_argument("--silent", action="store_true", help="音声なし(確認用)")
    args = ap.parse_args()
    ids = args.episodes or sorted(d for d in os.listdir(OUT) if os.path.isdir(os.path.join(OUT, d)))
    if not ids:
        sys.exit("video/out にコマがありません。先に node video/capture.js を実行してください。")
    for ep_id in ids:
        render_episode(ep_id, args.silent)


if __name__ == "__main__":
    main()
