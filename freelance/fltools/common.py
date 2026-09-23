"""各ツール共通のユーティリティ(入出力・Markdown簡易パーサ・エンコーディング判定)。"""

from __future__ import annotations

import json
import re
from pathlib import Path

JP_FONT = "游ゴシック"  # Windows/Mac の Office で標準的に表示できる日本語フォント


def load_spec(path: str | Path) -> dict:
    """JSON 仕様ファイルを読み込む。"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def ensure_parent(path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def detect_encoding(path: str | Path) -> str:
    """日本の受託案件で頻出の Shift_JIS(cp932) / UTF-8(BOM付き含む) を判定する。"""
    raw = Path(path).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    for enc in ("utf-8", "cp932"):
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    try:
        from charset_normalizer import from_bytes

        best = from_bytes(raw).best()
        if best:
            return best.encoding
    except ImportError:
        pass
    return "utf-8"


def parse_markdown(text: str) -> list[dict]:
    """docx/pptx 生成用の簡易 Markdown パーサ。

    対応: 見出し(#〜###)、箇条書き(- / *)、番号付き(1.)、表(| a | b |)、
    改ページ(---pagebreak---)、通常段落。
    """
    blocks: list[dict] = []
    lines = text.splitlines()
    i = 0
    para: list[str] = []

    def flush_para():
        if para:
            blocks.append({"type": "paragraph", "text": " ".join(s.strip() for s in para)})
            para.clear()

    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            flush_para()
            i += 1
            continue
        if stripped == "---pagebreak---":
            flush_para()
            blocks.append({"type": "pagebreak"})
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            flush_para()
            blocks.append({"type": "heading", "level": len(m.group(1)), "text": m.group(2).strip()})
            i += 1
            continue
        if stripped.startswith("|"):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                    rows.append(cells)
                i += 1
            if rows:
                blocks.append({"type": "table", "headers": rows[0], "rows": rows[1:]})
            continue
        m = re.match(r"^(\s*)([-*]|\d+[.)])\s+(.*)$", line)
        if m:
            flush_para()
            kind = "numbered" if m.group(2)[0].isdigit() else "bullets"
            items = []
            while i < len(lines):
                mm = re.match(r"^(\s*)([-*]|\d+[.)])\s+(.*)$", lines[i].rstrip())
                if not mm or ("numbered" if mm.group(2)[0].isdigit() else "bullets") != kind:
                    break
                items.append({"text": mm.group(3).strip(), "level": len(mm.group(1).expandtabs(4)) // 2})
                i += 1
            blocks.append({"type": kind, "items": items})
            continue
        para.append(stripped)
        i += 1
    flush_para()
    return blocks


def strip_inline_md(text: str) -> str:
    """**太字** や `code` などのインライン記法を除去(プレーン文字列化)。"""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    return text


def split_bold(text: str) -> list[tuple[str, bool]]:
    """'通常 **太字** 通常' を [(文字列, 太字か)] に分割する。"""
    parts = re.split(r"(\*\*.+?\*\*)", text)
    out = []
    for p in parts:
        if not p:
            continue
        if p.startswith("**") and p.endswith("**"):
            out.append((p[2:-2], True))
        else:
            out.append((re.sub(r"`(.+?)`", r"\1", p), False))
    return out
