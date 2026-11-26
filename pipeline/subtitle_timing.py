"""無料ローカルTTS(VOICEVOX/pyttsx3)向けの字幕タイミング推定。

ElevenLabsの `with-timestamps` のような文字単位の正確なアライメントは
これらのエンジンからは得られない。そのためシーン単位の映像/音声同期は
実測した音声長(ffprobe)に基づき完全に一致させつつ、シーン内の字幕キュー
切り替えタイミングは文字数比に応じた近似値で配分する。
(完璧なフレーム同期ではなく、意図的な設計上のトレードオフであることを明記する)
"""
from __future__ import annotations

_BREAK_CHARS = set("。、！？!?\n」』…")


def chunk_text(text: str, max_chars: int) -> list[str]:
    """`max_chars` を絶対に超えないように text を分割する。

    句読点等の区切り文字に達していれば(かつある程度の長さが溜まっていれば)
    そこで自然に改行するが、区切りが見つからなくても max_chars に達した時点で
    必ず改行する(1080px縦動画・フォントサイズ78px想定で、画面幅をはみ出さない
    ための絶対上限。以前は 1.6倍 までの延長を許していたが、それだと1行が
    画面幅を大きく超えてはみ出すことが実機検証で判明したため撤廃した)。
    """
    if not text:
        return []

    min_break_len = max(2, max_chars // 2)
    chunks: list[str] = []
    buf: list[str] = []
    for ch in text:
        buf.append(ch)
        is_break = ch in _BREAK_CHARS
        if len(buf) >= max_chars or (is_break and len(buf) >= min_break_len):
            chunks.append("".join(buf))
            buf = []
    if buf:
        chunks.append("".join(buf))
    return chunks


def split_cues_proportional(
    text: str, total_duration: float, max_chars: int, max_cue_duration: float
) -> list[dict]:
    if not text or total_duration <= 0:
        return []

    chunks = chunk_text(text, max_chars)
    total_chars = sum(len(c) for c in chunks) or 1

    cues: list[dict] = []
    t = 0.0
    for chunk in chunks:
        weight = len(chunk) / total_chars
        duration = max(0.3, min(max_cue_duration, total_duration * weight))
        cues.append({"start": t, "end": min(t + duration, total_duration), "text": chunk.strip()})
        t += duration

    if cues:
        cues[-1]["end"] = total_duration

    return [c for c in cues if c["text"]]
