#!/usr/bin/env python3
"""受託案件・自動処理ワークフローの入口(① 司令塔コアが呼び出すCLI)。

  python freelance/fl.py <コマンド> --help

  project  ⑩ 案件フォルダ・進捗・納品パッケージ管理
  xlsx     ② Excel 自動構築(JSON仕様 / CSV)
  docx     ③ Word 文書生成(Markdown / JSON仕様)
  pptx     ④ PowerPoint 生成(Markdown)
  pdf      ⑤ PDF化・結合・分割・テキスト抽出
  scrape   ⑥ Webデータ収集(robots.txt遵守)
  clean    ⑦ CSV/Excel データ整形
  check    ⑧ 納品前の品質チェック
  write    ⑨ 応募文・納品連絡などのビジネス文面
  doctor   環境チェック(依存ライブラリ・LibreOffice・日本語フォント)
"""

from __future__ import annotations

import argparse
import importlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

MODULES = ["file_manager", "xlsx_engine", "docx_engine", "pptx_engine", "pdf_tools",
           "scraper", "data_parser", "qa_checker", "biz_writer"]


def doctor(_args) -> int:
    ok = True
    for mod, pkg in [("openpyxl", "openpyxl"), ("docx", "python-docx"), ("pptx", "python-pptx"), ("pypdf", "pypdf"),
                     ("pandas", "pandas"), ("requests", "requests"), ("bs4", "beautifulsoup4"), ("anthropic", "anthropic")]:
        try:
            importlib.import_module(mod)
            print(f"  ✅ {pkg}")
        except ImportError:
            ok = False
            print(f"  ❌ {pkg}  → pip install -r freelance/requirements.txt")
    so = shutil.which("soffice") or shutil.which("libreoffice")
    if so:
        prog = Path(os.path.realpath(so)).parent
        missing = [n for n, lib in (("writer", "libswlo.so"), ("calc", "libsclo.so"), ("impress", "libsdlo.so"))
                   if not (prog / lib).exists()]
        if missing:
            print(f"  ⚠️ LibreOffice の {'/'.join(missing)} が未導入 → apt install " + " ".join(f"libreoffice-{m}" for m in missing))
        else:
            print("  ✅ LibreOffice(PDF変換・Excel再計算チェック可)")
    else:
        print("  ⚠️ LibreOffice なし → PDF変換と数式再計算チェックが使えません(apt install libreoffice)")
    try:
        fonts = subprocess.run(["fc-list", ":lang=ja"], capture_output=True, text=True).stdout
        cjk = "Noto Sans CJK" in fonts or "IPA" in fonts or "Noto Serif CJK" in fonts
        print(f"  {'✅' if cjk else '⚠️'} 日本語フォント {'あり' if cjk else '→ PDF化で文字化け防止に fonts-noto-cjk 推奨'}")
    except FileNotFoundError:
        pass
    print(f"  {'✅' if os.environ.get('ANTHROPIC_API_KEY') else 'ℹ️'} ANTHROPIC_API_KEY {'設定済み' if os.environ.get('ANTHROPIC_API_KEY') else '未設定(write --ai を使う時だけ必要)'}")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="fl", description="受託案件・自動処理ワークフロー")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in MODULES:
        importlib.import_module(f"fltools.{name}").register(sub)
    sub.add_parser("doctor", help="環境チェック").set_defaults(func=doctor)
    args = parser.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
