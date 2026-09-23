"""⑦ CSV/データパーサー: 煩雑なデータを一瞬で綺麗に整形する。

よくある受託データ整理の処理を一括で行う:
  - 文字コード自動判定(Shift_JIS / UTF-8 / BOM付き)→ Excel で文字化けしない UTF-8(BOM付き)で出力
  - 全角英数・半角カナの統一(NFKC)、前後空白・改行・連続スペースの除去
  - 完全重複行 / キー列指定の重複行の削除、空行・空列の削除
  - 日付(2026/9/1, 令和8年9月1日, 20260901 等)→ YYYY-MM-DD
  - 電話番号 → ハイフン付き、郵便番号 → 123-4567、金額(¥1,000円)→ 数値
  - 列名の変更・並べ替え・抽出

例:
  python fl.py clean input.csv -o clean.csv --dedupe --date-cols 登録日 --phone-cols 電話番号
  python fl.py clean input.xlsx --profile        # まず中身の状態を診断
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import pandas as pd

from .common import detect_encoding, ensure_parent

ERA = {"令和": 2018, "平成": 1988, "昭和": 1925, "R": 2018, "H": 1988, "S": 1925}


def read_table(path: str, sheet: str | None = None) -> pd.DataFrame:
    p = Path(path)
    if p.suffix.lower() in (".xlsx", ".xlsm", ".xls"):
        return pd.read_excel(p, sheet_name=sheet or 0, dtype=str)
    sep = "\t" if p.suffix.lower() == ".tsv" else ","
    return pd.read_csv(p, encoding=detect_encoding(p), dtype=str, sep=sep, keep_default_na=False)


def write_table(df: pd.DataFrame, out: str) -> None:
    p = ensure_parent(out)
    if p.suffix.lower() == ".xlsx":
        from .xlsx_engine import build_from_spec

        build_from_spec({"sheets": [{"name": "データ", "columns": [{"header": c, "key": c} for c in df.columns],
                                     "rows": df.fillna("").values.tolist()}]}, str(p))
    else:
        df.to_csv(p, index=False, encoding="utf-8-sig")


def norm_text(v):
    if not isinstance(v, str):
        return v
    v = unicodedata.normalize("NFKC", v)
    v = v.replace("\r", " ").replace("\n", " ").replace("　", " ")
    return re.sub(r"\s{2,}", " ", v).strip()


def norm_date(v):
    if not isinstance(v, str) or not v.strip():
        return v
    s = unicodedata.normalize("NFKC", v).strip()
    m = re.match(r"^(令和|平成|昭和|[RHS])\s*(元|\d+)[年.\-/]\s*(\d+)[月.\-/]\s*(\d+)日?", s)
    if m:
        y = ERA[m.group(1)] + (1 if m.group(2) == "元" else int(m.group(2)))
        return f"{y:04d}-{int(m.group(3)):02d}-{int(m.group(4)):02d}"
    m = re.match(r"^(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    try:
        return pd.to_datetime(s).strftime("%Y-%m-%d")
    except (ValueError, OverflowError):
        return v  # 変換できないものは触らない(QAで検出させる)


def norm_phone(v):
    if not isinstance(v, str) or not v.strip():
        return v
    d = re.sub(r"\D", "", unicodedata.normalize("NFKC", v))
    if d.startswith("81"):
        d = "0" + d[2:]
    if re.fullmatch(r"0[789]0\d{8}", d):
        return f"{d[:3]}-{d[3:7]}-{d[7:]}"
    if re.fullmatch(r"0120\d{6}", d):
        return f"{d[:4]}-{d[4:7]}-{d[7:]}"
    if re.fullmatch(r"0[36]\d{8}", d):
        return f"{d[:2]}-{d[2:6]}-{d[6:]}"
    if len(d) == 10 and d.startswith("0"):
        return f"{d[:3]}-{d[3:6]}-{d[6:]}"  # 市外局番の桁数は地域差あり。概ね3桁で揃える
    return v


def norm_zip(v):
    if not isinstance(v, str):
        return v
    d = re.sub(r"\D", "", unicodedata.normalize("NFKC", v))
    return f"{d[:3]}-{d[3:]}" if len(d) == 7 else v


def norm_money(v):
    if not isinstance(v, str) or not v.strip():
        return v
    s = unicodedata.normalize("NFKC", v).replace(",", "").replace("¥", "").replace("円", "").replace("\\", "").strip()
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*(万)?", s)
    if not m:
        return v
    n = float(m.group(1)) * (10000 if m.group(2) else 1)
    return str(int(n)) if n == int(n) else str(n)


def profile(df: pd.DataFrame) -> str:
    lines = [f"行数: {len(df)} / 列数: {len(df.columns)}", f"完全重複行: {int(df.duplicated().sum())}", ""]
    lines.append("| 列名 | 空欄 | ユニーク数 | 前後空白あり | 全角英数あり | 例 |")
    lines.append("|---|---|---|---|---|---|")
    for c in df.columns:
        col = df[c].fillna("").astype(str)
        blanks = int((col.str.strip() == "").sum())
        ws = int((col != col.str.strip()).sum())
        zen = int(col.str.contains(r"[Ａ-Ｚａ-ｚ０-９]").sum())
        ex = next((x for x in col if x.strip()), "")[:20]
        lines.append(f"| {c} | {blanks} | {col.nunique()} | {ws} | {zen} | {ex} |")
    return "\n".join(lines)


def clean(df: pd.DataFrame, args) -> pd.DataFrame:
    before = len(df)
    df = df.copy()
    df.columns = [norm_text(str(c)) for c in df.columns]
    if not args.no_normalize:
        df = df.map(norm_text)
    df = df.replace("", pd.NA).dropna(how="all").dropna(axis=1, how="all").fillna("")
    for opt, fn in (("date_cols", norm_date), ("phone_cols", norm_phone), ("zip_cols", norm_zip), ("money_cols", norm_money)):
        for c in getattr(args, opt) or []:
            if c not in df.columns:
                raise SystemExit(f"列が見つかりません: {c}(存在する列: {list(df.columns)})")
            df[c] = df[c].map(fn)
    if args.dedupe or args.dedupe_keys:
        df = df.drop_duplicates(subset=args.dedupe_keys or None, keep="first")
    if args.rename:
        df = df.rename(columns=dict(r.split("=", 1) for r in args.rename))
    if args.columns:
        df = df[args.columns]
    if args.sort:
        df = df.sort_values(args.sort, kind="stable")
    print(f"[clean] {before}行 → {len(df)}行")
    return df


def run(args) -> int:
    df = read_table(args.input, args.sheet)
    if args.profile:
        print(profile(df))
        return 0
    df = clean(df, args)
    out = args.out or str(Path(args.input).with_name(Path(args.input).stem + "_clean.csv"))
    write_table(df, out)
    print(f"[clean] 保存しました: {out}")
    return 0


def register(sub) -> None:
    p = sub.add_parser("clean", help="⑦ CSV/Excelデータを整形・正規化")
    p.add_argument("input", help="CSV / TSV / Excel")
    p.add_argument("-o", "--out", help="出力(.csv または .xlsx)")
    p.add_argument("--sheet", help="Excel のシート名")
    p.add_argument("--profile", action="store_true", help="整形せず、データの状態を診断表示")
    p.add_argument("--no-normalize", action="store_true", help="全角半角・空白の正規化をしない")
    p.add_argument("--dedupe", action="store_true", help="完全重複行を削除")
    p.add_argument("--dedupe-keys", nargs="+", help="この列の組み合わせで重複削除")
    p.add_argument("--date-cols", nargs="+")
    p.add_argument("--phone-cols", nargs="+")
    p.add_argument("--zip-cols", nargs="+")
    p.add_argument("--money-cols", nargs="+")
    p.add_argument("--rename", nargs="+", help="旧名=新名")
    p.add_argument("--columns", nargs="+", help="出力する列と順番")
    p.add_argument("--sort", nargs="+", help="並べ替えキー列")
    p.set_defaults(func=run)
