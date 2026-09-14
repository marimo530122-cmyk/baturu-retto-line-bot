"""無料ローカルTTS(VOICEVOX/pyttsx3)向けの字幕タイミング推定。

ElevenLabsの `with-timestamps` のような文字単位の正確なアライメントは
これらのエンジンからは得られない。そのためシーン単位の映像/音声同期は
実測した音声長(ffprobe)に基づき完全に一致させつつ、シーン内の字幕キュー
切り替えタイミングは文字数比に応じた近似値で配分する。
(完璧なフレーム同期ではなく、意図的な設計上のトレードオフであることを明記する)
"""
from __future__ import annotations

_BREAK_CHARS = set("。、！？!?\n」』…")


def split_cues_proportional(
    text: str, total_duration: float, max_chars: int, max_cue_duration: float
) -> list[dict]:
    if not text or total_duration <= 0:
        return []

    chunks: list[str] = []
    buf: list[str] = []
    for ch in text:
        buf.append(ch)
        is_break = ch in _BREAK_CHARS
        if (len(buf) >= max_chars and is_break) or len(buf) >= int(max_chars * 1.6):
            chunks.append("".join(buf))
            buf = []
    if buf:
        chunks.append("".join(buf))

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
