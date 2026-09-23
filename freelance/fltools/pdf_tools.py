"""⑤ pdf変換・処理ツール: 納品物のPDF化(LibreOffice)、結合、分割、テキスト抽出、情報表示。"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


from .common import ensure_parent


def soffice_bin() -> str | None:
    return shutil.which("soffice") or shutil.which("libreoffice")


def convert(src: str, out_dir: str | None = None, fmt: str = "pdf") -> Path:
    """xlsx/docx/pptx/csv 等を LibreOffice ヘッドレスで変換する(既定はPDF)。"""
    exe = soffice_bin()
    if not exe:
        raise SystemExit("LibreOffice(soffice)が見つかりません。apt install libreoffice でインストールしてください")
    src_p = Path(src).resolve()
    out = Path(out_dir or src_p.parent).resolve()
    out.mkdir(parents=True, exist_ok=True)
    # 同時実行で競合しないよう一時プロファイルを使う
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run(
            [exe, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", fmt,
             "--outdir", str(out), str(src_p)],
            check=True, capture_output=True, timeout=300,
        )
    result = out / (src_p.stem + "." + fmt.split(":")[0])
    if not result.exists():
        raise SystemExit(f"変換に失敗しました: {src}")
    return result


def merge(inputs: list[str], out: str) -> Path:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for f in inputs:
        pdf = f if f.lower().endswith(".pdf") else str(convert(f, tempfile.mkdtemp()))
        writer.append(pdf, outline_item=Path(f).stem)
    path = ensure_parent(out)
    with open(path, "wb") as fh:
        writer.write(fh)
    return path


def split(src: str, out_dir: str, ranges: str | None = None) -> list[Path]:
    """ranges 例: "1-3,4,5-8"(省略時は1ページずつ)。"""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(src)
    n = len(reader.pages)
    groups = []
    if ranges:
        for part in ranges.split(","):
            a, _, b = part.partition("-")
            groups.append(list(range(int(a) - 1, int(b or a))))
    else:
        groups = [[i] for i in range(n)]
    outs = []
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    for g in groups:
        w = PdfWriter()
        for i in g:
            w.add_page(reader.pages[i])
        name = Path(out_dir) / f"{Path(src).stem}_p{g[0] + 1}{'-' + str(g[-1] + 1) if len(g) > 1 else ''}.pdf"
        with open(name, "wb") as fh:
            w.write(fh)
        outs.append(name)
    return outs


def extract_text(src: str) -> str:
    from pypdf import PdfReader

    return "\n\n".join(f"--- p.{i + 1} ---\n{p.extract_text() or ''}" for i, p in enumerate(PdfReader(src).pages))


def run(args) -> int:
    if args.action == "convert":
        for f in args.files:
            print(f"[pdf] 変換: {convert(f, args.out_dir, args.format)}")
    elif args.action == "merge":
        print(f"[pdf] 結合: {merge(args.files, args.out)}")
    elif args.action == "split":
        for p in split(args.files[0], args.out_dir or ".", args.ranges):
            print(f"[pdf] 分割: {p}")
    elif args.action == "text":
        text = extract_text(args.files[0])
        if args.out:
            ensure_parent(args.out).write_text(text, encoding="utf-8")
            print(f"[pdf] テキスト抽出: {args.out}")
        else:
            print(text)
    elif args.action == "info":
        from pypdf import PdfReader

        for f in args.files:
            r = PdfReader(f)
            meta = r.metadata or {}
            print(f"{f}: {len(r.pages)}ページ / タイトル={meta.get('/Title', '')} / 暗号化={r.is_encrypted}")
    return 0


def register(sub) -> None:
    p = sub.add_parser("pdf", help="⑤ PDF化・結合・分割・テキスト抽出")
    p.add_argument("action", choices=["convert", "merge", "split", "text", "info"])
    p.add_argument("files", nargs="+")
    p.add_argument("-o", "--out", help="merge/text の出力ファイル")
    p.add_argument("--out-dir", help="convert/split の出力先")
    p.add_argument("--format", default="pdf", help="convert の変換先形式(pdf, xlsx, docx 等)")
    p.add_argument("--ranges", help='split のページ範囲 例: "1-3,4"')
    p.set_defaults(func=run)
