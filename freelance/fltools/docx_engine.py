"""③ docx自動生成モジュール: Markdown(または JSON仕様)からプロ仕様の Word 文書を生成する。

司令塔(Claude Code)は中身を Markdown で書くだけでよい。見出しスタイル・日本語フォント・
表の罫線・表紙・目次・ページ番号はこのモジュールが自動で付ける。

JSON仕様の例: templates/specs/sample_docx.json
  {"title": "...", "subtitle": "...", "author": "...", "date": "2026年9月23日",
   "cover": true, "toc": true, "markdown_file": "body.md"}   # または "markdown": "..."
"""

from __future__ import annotations

import datetime
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

from .common import JP_FONT, ensure_parent, load_spec, parse_markdown, split_bold, strip_inline_md

ACCENT = RGBColor(0x1F, 0x4E, 0x78)


def _set_font(style_or_run, size=None, bold=None, color=None):
    font = style_or_run.font
    font.name = JP_FONT
    rpr = style_or_run.element.get_or_add_rPr() if hasattr(style_or_run.element, "get_or_add_rPr") \
        else style_or_run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia"):
        rfonts.set(qn(attr), JP_FONT)
    if size:
        font.size = Pt(size)
    if bold is not None:
        font.bold = bold
    if color is not None:
        font.color.rgb = color


def _setup_styles(doc: Document) -> None:
    _set_font(doc.styles["Normal"], size=10.5)
    doc.styles["Normal"].paragraph_format.space_after = Pt(4)
    doc.styles["Normal"].paragraph_format.line_spacing = 1.3
    for lvl, size in ((1, 16), (2, 13), (3, 11.5)):
        st = doc.styles[f"Heading {lvl}"]
        _set_font(st, size=size, bold=True, color=ACCENT)
        st.paragraph_format.space_before = Pt(12 if lvl == 1 else 8)
        st.paragraph_format.space_after = Pt(4)
    for name in ("Title", "Subtitle", "List Bullet", "List Number", "List Bullet 2", "List Number 2"):
        if name in [s.name for s in doc.styles]:
            _set_font(doc.styles[name])


def _add_runs(paragraph, text: str) -> None:
    for chunk, bold in split_bold(text):
        run = paragraph.add_run(chunk)
        run.bold = bold


def _add_field(paragraph, instr: str) -> None:
    """ページ番号・目次などのフィールドを挿入する(Word で開いたとき更新される)。"""
    run = paragraph.add_run()
    for tag, text in (("begin", None), (None, instr), ("separate", None), ("end", None)):
        if tag:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), tag)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)


def _add_table(doc: Document, headers: list[str], rows: list[list[str]]) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(strip_inline_md(h))
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:fill"), "1F4E78")
        cell._tc.get_or_add_tcPr().append(shd)
    for r in rows:
        cells = table.add_row().cells
        for i in range(len(headers)):
            cells[i].text = ""
            _add_runs(cells[i].paragraphs[0], r[i] if i < len(r) else "")
    doc.add_paragraph()


def render_blocks(doc: Document, blocks: list[dict]) -> None:
    for b in blocks:
        t = b["type"]
        if t == "heading":
            doc.add_heading(strip_inline_md(b["text"]), level=min(b["level"], 3))
        elif t == "paragraph":
            _add_runs(doc.add_paragraph(), b["text"])
        elif t in ("bullets", "numbered"):
            base = "List Bullet" if t == "bullets" else "List Number"
            for item in b["items"]:
                style = base + (" 2" if item["level"] >= 1 else "")
                _add_runs(doc.add_paragraph(style=style), item["text"])
        elif t == "table":
            _add_table(doc, b["headers"], b["rows"])
        elif t == "pagebreak":
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def build(markdown: str, out: str, title: str | None = None, subtitle: str | None = None,
          author: str | None = None, date: str | None = None, cover: bool = False,
          toc: bool = False, landscape: bool = False) -> Path:
    doc = Document()
    _setup_styles(doc)
    sec = doc.sections[0]
    if landscape:
        sec.orientation = WD_ORIENT.LANDSCAPE
        sec.page_width, sec.page_height = sec.page_height, sec.page_width

    blocks = parse_markdown(markdown)
    # 表紙を作らない場合、Markdown 先頭の H1 を文書タイトルとして使う
    if not title and blocks and blocks[0]["type"] == "heading" and blocks[0]["level"] == 1:
        title = strip_inline_md(blocks.pop(0)["text"])

    if cover and title:
        for _ in range(8):
            doc.add_paragraph()
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(title)
        _set_font(r, size=26, bold=True, color=ACCENT)
        if subtitle:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _set_font(p.add_run(subtitle), size=14)
        for _ in range(10):
            doc.add_paragraph()
        for line in (date or datetime.date.today().strftime("%Y年%m月%d日"), author):
            if line:
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                _set_font(p.add_run(line), size=12)
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    elif title:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run(title), size=18, bold=True, color=ACCENT)
        if subtitle or author or date:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            p.add_run("  ".join(x for x in (subtitle, date, author) if x))

    if toc:
        doc.add_heading("目次", level=1)
        _add_field(doc.add_paragraph(), 'TOC \\o "1-3" \\h \\z \\u')
        doc.add_paragraph("※Wordで開いたら目次を右クリック→「フィールド更新」で最新化されます。")
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    render_blocks(doc, blocks)

    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _add_field(footer, "PAGE")

    if title:
        doc.core_properties.title = title
    if author:
        doc.core_properties.author = author
    path = ensure_parent(out)
    doc.save(path)
    return path


def run(args) -> int:
    opts = {}
    if args.spec:
        spec = load_spec(args.spec)
        md = spec.get("markdown") or Path(Path(args.spec).parent, spec["markdown_file"]).read_text(encoding="utf-8")
        opts = {k: spec.get(k) for k in ("title", "subtitle", "author", "date")}
        opts.update(cover=spec.get("cover", False), toc=spec.get("toc", False), landscape=spec.get("landscape", False))
    else:
        md = Path(args.md).read_text(encoding="utf-8")
        opts = dict(title=args.title, subtitle=args.subtitle, author=args.author, date=None,
                    cover=args.cover, toc=args.toc, landscape=args.landscape)
    path = build(md, args.out, **opts)
    print(f"[docx] 生成しました: {path}")
    return 0


def register(sub) -> None:
    p = sub.add_parser("docx", help="③ Word文書を Markdown / JSON仕様 から生成")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--md", help="本文 Markdown ファイル")
    src.add_argument("--spec", help="JSON仕様ファイル")
    p.add_argument("--title")
    p.add_argument("--subtitle")
    p.add_argument("--author")
    p.add_argument("--cover", action="store_true", help="表紙ページを付ける")
    p.add_argument("--toc", action="store_true", help="目次を付ける")
    p.add_argument("--landscape", action="store_true", help="横向き")
    p.add_argument("-o", "--out", required=True)
    p.set_defaults(func=run)
