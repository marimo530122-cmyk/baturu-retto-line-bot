#!/usr/bin/env python3
"""Auto-edit raw phone footage into a captioned vertical short (MP4).

Pipeline (the "transcribe first, touch pixels last" approach):
  1. Extract audio and transcribe it with faster-whisper (word-level timestamps).
  2. Decide what to keep from the transcript alone:
       - drop filler words (えー / あのー / えっと ...)
       - cut pauses longer than --max-pause seconds
       - (optional, --ai) ask Claude to drop false starts / retakes / off-topic sentences
  3. Render once with ffmpeg: trim + concat the kept clips, fit to 9:16 (blurred
     background for landscape footage), light color correction, audio cleanup
     (denoise, short fades at every cut, loudness normalize), burned-in captions.
  4. Verify the export (streams present, duration matches the edit plan) and
     grab a few preview frames plus a Markdown edit report.

Usage:
    python scripts/auto_edit_video.py --input raw.mp4 --title "今日の仕込み"
    python scripts/auto_edit_video.py --input "https://drive.google.com/file/d/.../view" --ai
    # Re-edit without re-transcribing (e.g. after fixing typos in the JSON by hand):
    python scripts/auto_edit_video.py --input raw.mp4 --transcript output/xxx.transcript.json
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.request
from dataclasses import dataclass

from generate_short_video import HEIGHT, OUTPUT_DIR, WIDTH, format_ass_time, probe_duration, slugify

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5")
MAX_CAPTION_CHARS = int(os.environ.get("MAX_CAPTION_CHARS", "14"))

# Whisper tends to silently drop disfluencies. Seeding the prompt with fillers
# makes it transcribe them, so we get their timestamps and can cut them.
WHISPER_PROMPT = "えー、あのー、えっと、まあ、うーん、そのー。はい、じゃあ始めます。"

FILLER_RE = re.compile(
    r"^(え[ーぇ]+|えっ?と[ー]*|え[ー]+っ?と[ー]*|あ[ーぁ]+|あのー+|あのぉ+|そのー+|う[ー]*ん[ー]*|ん[ー]+|ま[ー]+|まぁ+)$"
)
PUNCT = "、。,.!?！？…・ 　「」"


@dataclass
class Word:
    start: float
    end: float
    text: str
    segment: int


@dataclass
class Clip:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


# ---------------------------------------------------------------- input


def fetch_input(src: str, workdir: str) -> str:
    if os.path.exists(src):
        return src
    if not re.match(r"^https?://", src):
        raise SystemExit(f"入力ファイルが見つかりません: {src}")

    dest = os.path.join(workdir, "input_video")
    if "drive.google.com" in src:
        import gdown

        path = gdown.download(src, dest + ".mp4", quiet=False, fuzzy=True)
        if not path:
            raise SystemExit("Googleドライブからのダウンロードに失敗しました(共有設定が「リンクを知っている全員」か確認してください)。")
        return path

    dest += os.path.splitext(src.split("?")[0])[1] or ".mp4"
    print(f"Downloading {src} ...")
    urllib.request.urlretrieve(src, dest)
    return dest


# ---------------------------------------------------------- transcription


def transcribe(video_path: str, model_name: str) -> dict:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        video_path,
        language="ja",
        word_timestamps=True,
        initial_prompt=WHISPER_PROMPT,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
    )
    out = {"segments": []}
    for seg in segments:
        out["segments"].append(
            {
                "text": seg.text.strip(),
                "start": seg.start,
                "end": seg.end,
                "words": [
                    {"start": w.start, "end": w.end, "text": w.word.strip()}
                    for w in (seg.words or [])
                    if w.word.strip()
                ],
            }
        )
    return out


def flatten_words(transcript: dict) -> list[Word]:
    words = []
    for i, seg in enumerate(transcript["segments"]):
        for w in seg["words"]:
            words.append(Word(start=float(w["start"]), end=float(w["end"]), text=w["text"], segment=i))
    return words


def is_filler(text: str) -> bool:
    core = text.strip(PUNCT)
    return bool(core) and bool(FILLER_RE.match(core))


def merge_fillers(words: list[Word]) -> list[Word]:
    """Whisper often splits 'えー' into 'え' + 'ー'; rejoin such fragments so the regex sees them."""
    merged: list[Word] = []
    for w in words:
        if merged and w.text.strip(PUNCT) and set(w.text.strip(PUNCT)) <= set("ーぇぁっと") and (
            is_filler(merged[-1].text + w.text) or merged[-1].text.strip(PUNCT) in ("え", "あ", "う", "ん", "ま")
        ):
            prev = merged[-1]
            merged[-1] = Word(prev.start, w.end, prev.text + w.text, prev.segment)
        else:
            merged.append(w)
    return merged


# ------------------------------------------------------------ AI pass


AI_SYSTEM_PROMPT = """あなたはショート動画の編集者です。スマホで撮影した自撮り動画の文字起こし(番号付きの文)を渡します。
視聴者に見せるべきでない文の番号だけを選んでください。対象は次の2種類だけです。
- 言い直し・撮り直し: 同じ内容を2回以上言っている場合、最後の(一番うまく言えている)もの以外
- 明らかな失敗・独り言: 「今のなし」「もう一回」「あれ?」のような撮影者向けの発言

迷ったら残してください(削りすぎより残しすぎの方が安全です)。内容の要約や言い換えはしないでください。
出力は次のJSONだけ: {"drop": [番号, ...], "reasons": {"番号": "理由", ...}}"""


def ai_select_drops(transcript: dict) -> tuple[set[int], dict[str, str]]:
    import anthropic

    numbered = "\n".join(f"[{i}] {seg['text']}" for i, seg in enumerate(transcript["segments"]))
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        system=AI_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": numbered}],
    )
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    parsed = json.loads(text)
    drops = {int(i) for i in parsed.get("drop", []) if 0 <= int(i) < len(transcript["segments"])}
    return drops, {str(k): str(v) for k, v in (parsed.get("reasons") or {}).items()}


# ------------------------------------------------------------ edit plan


def plan_clips(
    words: list[Word], total: float, max_pause: float, pad_before: float, pad_after: float
) -> list[Clip]:
    """Group kept words into continuous clips; any gap longer than max_pause becomes a cut."""
    clips: list[Clip] = []
    for w in words:
        if clips and w.start - clips[-1].end <= max_pause:
            clips[-1].end = max(clips[-1].end, w.end)
        else:
            clips.append(Clip(w.start, w.end))

    padded: list[Clip] = []
    for c in clips:
        start = max(0.0, c.start - pad_before)
        end = min(total, c.end + pad_after)
        if padded and start <= padded[-1].end:
            padded[-1].end = max(padded[-1].end, end)
        else:
            padded.append(Clip(start, end))
    return [c for c in padded if c.duration >= 0.2]


def remap(t: float, clips: list[Clip]) -> float | None:
    """Map a source timestamp onto the edited timeline (None if it was cut)."""
    offset = 0.0
    for c in clips:
        if c.start <= t <= c.end:
            return offset + (t - c.start)
        offset += c.duration
    return None


# -------------------------------------------------------------- captions


ASS_HEADER = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Noto Sans CJK JP,78,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,6,2,2,60,60,380,1
Style: Title,Noto Sans CJK JP,84,&H0000E5FF,&H000000FF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,7,2,8,60,60,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def build_captions(words: list[Word], clips: list[Clip], duration: float) -> list[tuple[float, float, str]]:
    """Word-timed caption lines on the edited timeline, broken at sentence ends, cuts and length."""
    lines: list[tuple[float, float, str]] = []
    cur: list[tuple[float, float, str]] = []

    def flush() -> None:
        if cur:
            text = "".join(t for _, _, t in cur).strip(PUNCT)
            if text:
                lines.append((cur[0][0], cur[-1][1], text))
            cur.clear()

    for w in words:
        s, e = remap(w.start, clips), remap(w.end, clips)
        if s is None or e is None:
            flush()
            continue
        if cur and (len("".join(t for _, _, t in cur)) + len(w.text) > MAX_CAPTION_CHARS or s - cur[-1][1] > 0.3):
            flush()
        cur.append((s, e, w.text))
        if w.text and w.text[-1] in "。？！?!":
            flush()
    flush()

    # Keep each line on screen until the next one starts (avoids flicker between words).
    smoothed = []
    for i, (s, e, text) in enumerate(lines):
        nxt = lines[i + 1][0] if i + 1 < len(lines) else e + 0.3
        smoothed.append((s, min(duration, max(e, min(nxt, e + 0.6))), text))
    return smoothed


def write_ass(captions: list[tuple[float, float, str]], title: str | None, duration: float, path: str) -> None:
    td = lambda sec: format_ass_time(datetime.timedelta(seconds=sec))  # noqa: E731
    lines = [ASS_HEADER]
    if title:
        lines.append(f"Dialogue: 1,{td(0)},{td(duration)},Title,,0,0,0,,{title}\n")
    for s, e, text in captions:
        lines.append(f"Dialogue: 0,{td(s)},{td(e)},Caption,,0,0,0,,{text}\n")
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


# --------------------------------------------------------------- render


def build_filtergraph(clips: list[Clip], ass_path: str, color: bool, denoise: bool) -> str:
    parts = []
    fade = 0.02
    for i, c in enumerate(clips):
        parts.append(f"[0:v]trim=start={c.start:.3f}:end={c.end:.3f},setpts=PTS-STARTPTS[v{i}]")
        parts.append(
            f"[0:a]atrim=start={c.start:.3f}:end={c.end:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:d={fade},afade=t=out:st={max(0.0, c.duration - fade):.3f}:d={fade}[a{i}]"
        )
    parts.append("".join(f"[v{i}][a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=1:a=1[vc][ac]")

    # Fit any aspect ratio into 9:16: sharp foreground over a blurred, cropped copy.
    parts.append("[vc]fps=30,split[bgsrc][fgsrc]")
    parts.append(
        f"[bgsrc]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},boxblur=30:2[bg]"
    )
    parts.append(f"[fgsrc]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease[fg]")
    grade = ",eq=contrast=1.06:saturation=1.12:gamma=1.02" if color else ""
    escaped_ass = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    parts.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1{grade},ass='{escaped_ass}'[vout]")

    audio_chain = "highpass=f=80" + (",afftdn=nf=-25" if denoise else "") + ",loudnorm=I=-14:TP=-1.5:LRA=11"
    parts.append(f"[ac]{audio_chain},aresample=48000[aout]")
    return ";\n".join(parts)


def render(src: str, clips: list[Clip], ass_path: str, out_path: str, color: bool, denoise: bool) -> None:
    graph_path = out_path + ".filtergraph.txt"
    with open(graph_path, "w", encoding="utf-8") as f:
        f.write(build_filtergraph(clips, ass_path, color, denoise))
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning", "-stats",
        "-i", src,
        "-filter_complex_script", graph_path,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        out_path,
    ]  # fmt: skip
    subprocess.run(cmd, check=True)
    os.remove(graph_path)


# --------------------------------------------------------------- verify


def verify(out_path: str, expected: float) -> list[str]:
    problems = []
    streams = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", out_path],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    info = json.loads(streams).get("streams", [])
    kinds = {s["codec_type"] for s in info}
    if "video" not in kinds:
        problems.append("映像ストリームがありません")
    if "audio" not in kinds:
        problems.append("音声ストリームがありません")
    for s in info:
        if s["codec_type"] == "video" and (s.get("width"), s.get("height")) != (WIDTH, HEIGHT):
            problems.append(f"解像度が {s.get('width')}x{s.get('height')} です(期待値 {WIDTH}x{HEIGHT})")
    actual = probe_duration(out_path)
    if abs(actual - expected) > 0.5:
        problems.append(f"尺が編集計画と一致しません(計画 {expected:.1f}s / 実際 {actual:.1f}s)")
    return problems


def grab_previews(out_path: str, duration: float, count: int = 3) -> list[str]:
    paths = []
    for i in range(count):
        t = duration * (i + 1) / (count + 1)
        p = f"{os.path.splitext(out_path)[0]}.preview{i + 1}.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", out_path, "-frames:v", "1", "-vf", "scale=360:-2", p],
            check=True,
        )  # fmt: skip
        paths.append(p)
    return paths


def fmt_ts(sec: float) -> str:
    return f"{int(sec // 60)}:{sec % 60:05.2f}"


def write_report(path: str, **r) -> None:
    lines = [
        f"# 自動編集レポート: {r['title'] or os.path.basename(r['src'])}",
        "",
        f"- 元の尺: {fmt_ts(r['total'])} → 完成尺: {fmt_ts(r['final'])} "
        f"({(1 - r['final'] / r['total']) * 100:.0f}% カット)" if r["total"] else "",
        f"- 残したクリップ数: {len(r['clips'])}",
        f"- 除去したフィラー: {len(r['fillers'])}件" + (f"(例: {'、'.join(sorted({w.text.strip(PUNCT) for w in r['fillers']})[:8])})" if r["fillers"] else ""),
        (f"- AIカット: 失敗のためスキップ({r['ai_error']})" if r["ai_error"]
         else f"- AIが削除した文: {len(r['ai_drops'])}件" if r["ai_used"] else "- AIカット: 未使用(--ai で有効化)"),
        f"- 書き出しチェック: {'OK' if not r['problems'] else 'NG — ' + ' / '.join(r['problems'])}",
        "",
    ]
    if r["ai_drops"]:
        lines += ["## AIが削除した文", ""]
        for i in sorted(r["ai_drops"]):
            seg = r["segments"][i]
            reason = r["ai_reasons"].get(str(i), "")
            lines.append(f"- `{fmt_ts(seg['start'])}` {seg['text']}" + (f" — {reason}" if reason else ""))
        lines.append("")
    lines += ["## 残した区間(元動画の時刻)", ""]
    lines += [f"- {fmt_ts(c.start)} – {fmt_ts(c.end)}" for c in r["clips"]]
    lines += ["", "## 文字起こし(全文)", ""]
    lines += [f"- `{fmt_ts(s['start'])}` {s['text']}" for s in r["segments"]]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ----------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="撮影素材のパス、またはURL(Googleドライブ共有リンク可)")
    parser.add_argument("--title", help="画面上部に常時表示するタイトル(省略可)")
    parser.add_argument("--ai", action="store_true", help="Claudeで言い直し・撮り直しの文も削除する(ANTHROPIC_API_KEY が必要)")
    parser.add_argument("--transcript", help="既存の文字起こしJSON(指定すると文字起こしをスキップ)")
    parser.add_argument("--whisper-model", default=WHISPER_MODEL, help=f"faster-whisperのモデル(既定: {WHISPER_MODEL})")
    parser.add_argument("--max-pause", type=float, default=0.5, help="これより長い無音をカットする(秒)")
    parser.add_argument("--pad-before", type=float, default=0.08, help="各クリップの前に残す余白(秒)")
    parser.add_argument("--pad-after", type=float, default=0.15, help="各クリップの後に残す余白(秒)")
    parser.add_argument("--keep-fillers", action="store_true", help="フィラーを除去しない")
    parser.add_argument("--no-color", action="store_true", help="色補正をしない")
    parser.add_argument("--no-denoise", action="store_true", help="音声ノイズ除去をしない")
    parser.add_argument("--output", help="出力MP4のパス")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d-%H%M%S")
    slug = slugify(args.title or os.path.splitext(os.path.basename(args.input.split("?")[0]))[0] or "edit")
    base = os.path.join(OUTPUT_DIR, f"{timestamp}-{slug}")
    out_path = args.output or base + ".mp4"
    base = os.path.splitext(out_path)[0]

    src = fetch_input(args.input, OUTPUT_DIR)
    total = probe_duration(src)

    if args.transcript:
        print(f"[1/5] Loading transcript {args.transcript}")
        with open(args.transcript, encoding="utf-8") as f:
            transcript = json.load(f)
    else:
        print(f"[1/5] Transcribing with faster-whisper ({args.whisper_model})...")
        transcript = transcribe(src, args.whisper_model)
        with open(base + ".transcript.json", "w", encoding="utf-8") as f:
            json.dump(transcript, f, ensure_ascii=False, indent=1)
    if not any(seg["words"] for seg in transcript["segments"]):
        raise SystemExit("音声から発話を検出できませんでした。")

    print("[2/5] Planning cuts...")
    words = merge_fillers(flatten_words(transcript))
    fillers = [] if args.keep_fillers else [w for w in words if is_filler(w.text)]
    ai_drops: set[int] = set()
    ai_reasons: dict[str, str] = {}
    ai_error = ""
    if args.ai:
        try:
            ai_drops, ai_reasons = ai_select_drops(transcript)
        except Exception as e:  # noqa: BLE001 - AI pass is best-effort; the mechanical edit still ships
            ai_error = str(e)
            print(f"  AIカットをスキップしました: {e}", file=sys.stderr)
    filler_ids = {id(w) for w in fillers}
    kept = [w for w in words if id(w) not in filler_ids and w.segment not in ai_drops]
    if not kept:
        raise SystemExit("カットの結果、残る発話がありません。")
    clips = plan_clips(kept, total, args.max_pause, args.pad_before, args.pad_after)
    final = sum(c.duration for c in clips)
    print(f"  {fmt_ts(total)} -> {fmt_ts(final)} / {len(clips)} clips, {len(fillers)} fillers, {len(ai_drops)} AI drops")

    print("[3/5] Building captions...")
    ass_path = base + ".ass"
    write_ass(build_captions(kept, clips, final), args.title, final, ass_path)

    print("[4/5] Rendering with ffmpeg...")
    render(src, clips, ass_path, out_path, color=not args.no_color, denoise=not args.no_denoise)

    print("[5/5] Verifying export...")
    problems = verify(out_path, final)
    grab_previews(out_path, final)
    write_report(
        base + ".report.md", title=args.title, src=args.input, total=total, final=final, clips=clips,
        fillers=fillers, ai_used=args.ai, ai_error=ai_error, ai_drops=ai_drops, ai_reasons=ai_reasons,
        segments=transcript["segments"], problems=problems,
    )  # fmt: skip

    print(f"Wrote {out_path}")
    if problems:
        raise SystemExit("書き出しチェックNG: " + " / ".join(problems))


if __name__ == "__main__":
    main()
