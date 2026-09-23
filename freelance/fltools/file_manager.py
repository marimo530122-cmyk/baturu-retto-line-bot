"""⑩ ローカル・ファイルマネージャー: 案件ごとのフォルダ・進捗・納品パッケージを管理する。

案件フォルダの構成(projects/ 配下。クライアントの資料を含むため Git 管理外):
  projects/2026-09-23_山田商店_売上管理表/
    project.json      … 案件情報・ステータス・履歴
    01_brief/         … 案件本文(job.txt)、ヒアリングメモ、やり取り
    02_input/         … クライアントから受け取った元データ
    03_work/          … 作業用の仕様JSON・Markdown・中間ファイル
    04_output/        … 完成した成果物(ここが品質チェック対象)
    05_delivery/      … 納品用 zip と品質チェックレポート(版番号つき)

例:
  python fl.py project new "売上管理表の作成" --client 山田商店 --deadline 2026-10-01 --price 15000
  python fl.py project list
  python fl.py project status 売上管理表 作業中
  python fl.py project package 売上管理表      # 品質チェック→OKなら zip 化
"""

from __future__ import annotations

import datetime
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "projects"
SUBDIRS = ["01_brief", "02_input", "03_work", "04_output", "05_delivery"]
STATUSES = ["提案中", "受注", "作業中", "確認待ち", "修正中", "納品済", "検収済", "失注"]


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\s]+', "_", name).strip("_")[:40]


def find(key: str) -> Path:
    if not ROOT.exists():
        raise SystemExit("案件がまだありません。python fl.py project new で作成してください")
    hits = [p for p in ROOT.iterdir() if p.is_dir() and key in p.name]
    if len(hits) != 1:
        names = "\n  ".join(p.name for p in hits) or "(該当なし)"
        raise SystemExit(f"案件を1つに特定できません: {key}\n  {names}")
    return hits[0]


def load(p: Path) -> dict:
    return json.loads((p / "project.json").read_text(encoding="utf-8"))


def save(p: Path, meta: dict) -> None:
    (p / "project.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def log(p: Path, message: str) -> None:
    meta = load(p)
    meta.setdefault("history", []).append({"at": _now(), "event": message})
    save(p, meta)


def new(title: str, client: str, deadline: str | None, price: str | None, platform: str) -> Path:
    today = datetime.date.today().isoformat()
    p = ROOT / f"{today}_{_safe(client)}_{_safe(title)}"
    if p.exists():
        raise SystemExit(f"既に存在します: {p}")
    for d in SUBDIRS:
        (p / d).mkdir(parents=True)
    (p / "01_brief" / "job.txt").write_text("(ここに案件ページの募集本文をそのまま貼り付ける)\n", encoding="utf-8")
    (p / "01_brief" / "requirements.md").write_text(
        f"# 要件整理: {title}\n\n## 成果物(ファイル形式・数)\n- \n\n## 必須条件\n- \n\n"
        f"## 不明点(クライアントに確認すること)\n- \n\n## 受け入れ基準(これを満たせば納品OK)\n- \n",
        encoding="utf-8")
    save(p, {"title": title, "client": client, "platform": platform, "deadline": deadline, "price": price,
             "status": "提案中", "created": _now(), "delivery_version": 0,
             "history": [{"at": _now(), "event": "案件作成"}]})
    return p


def list_projects(show_all: bool) -> None:
    if not ROOT.exists():
        print("案件はまだありません")
        return
    today = datetime.date.today()
    rows = []
    for p in sorted(ROOT.iterdir()):
        if not (p / "project.json").exists():
            continue
        m = load(p)
        if not show_all and m["status"] in ("検収済", "失注"):
            continue
        left = ""
        if m.get("deadline"):
            try:
                d = (datetime.date.fromisoformat(m["deadline"]) - today).days
                left = f"残{d}日" if d >= 0 else f"⚠{-d}日超過"
            except ValueError:
                left = m["deadline"]
        rows.append((m["status"], m.get("deadline") or "-", left, m["client"], m["title"], m.get("price") or "-"))
    if not rows:
        print("進行中の案件はありません(--all で完了分も表示)")
        return
    print("| 状態 | 納期 | 残り | クライアント | 案件 | 金額 |\n|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda r: r[1]):
        print("| " + " | ".join(str(x) for x in r) + " |")


def package(p: Path, force: bool) -> Path | None:
    from .qa_checker import CHECKERS, check, render

    out_dir = p / "04_output"
    files = [f for f in sorted(out_dir.rglob("*")) if f.is_file() and not f.name.startswith(("~$", "."))]
    if not files:
        raise SystemExit(f"成果物がありません: {out_dir}")
    reports = [check(f) for f in files if f.suffix.lower() in CHECKERS]
    meta = load(p)
    version = meta.get("delivery_version", 0) + 1
    report_text = render(reports)
    report_path = p / "05_delivery" / f"品質チェック_v{version}.md"
    report_path.write_text(report_text, encoding="utf-8")
    errors = sum(r.errors for r in reports)
    print(report_text)
    if errors and not force:
        print(f"[project] ERROR {errors}件のため zip を作りませんでした(レポート: {report_path})")
        return None
    zip_path = p / "05_delivery" / f"{_safe(meta['title'])}_納品_v{version}_{datetime.date.today():%Y%m%d}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f.relative_to(out_dir))
    meta["delivery_version"] = version
    save(p, meta)
    log(p, f"納品パッケージ v{version} 作成({len(files)}ファイル)")
    return zip_path


def run(args) -> int:
    a = args.action
    if a == "new":
        p = new(args.name, args.client or "クライアント", args.deadline, args.price, args.platform)
        print(f"[project] 作成しました: {p}\n  → 01_brief/job.txt に案件本文を貼り付けてから司令塔に指示を出してください")
    elif a == "list":
        list_projects(args.all)
    elif a == "path":
        print(find(args.name))
    elif a == "status":
        if args.value not in STATUSES:
            raise SystemExit(f"ステータスは次のいずれか: {' / '.join(STATUSES)}")
        p = find(args.name)
        meta = load(p)
        meta["status"] = args.value
        save(p, meta)
        log(p, f"ステータス → {args.value}")
        print(f"[project] {p.name}: {args.value}")
    elif a == "log":
        log(find(args.name), args.value)
        print("[project] 記録しました")
    elif a == "show":
        p = find(args.name)
        print(json.dumps(load(p), ensure_ascii=False, indent=2))
        for d in SUBDIRS:
            fs = [f.name for f in (p / d).iterdir()] if (p / d).exists() else []
            print(f"  {d}/ {', '.join(fs) if fs else '(空)'}")
    elif a == "package":
        z = package(find(args.name), args.force)
        if z:
            print(f"[project] 納品zip: {z}")
            return 0
        return 1
    return 0


def register(sub) -> None:
    p = sub.add_parser("project", help="⑩ 案件フォルダ・進捗・納品パッケージの管理")
    p.add_argument("action", choices=["new", "list", "show", "path", "status", "log", "package"])
    p.add_argument("name", nargs="?", help="new: 案件名 / それ以外: 案件フォルダ名の一部")
    p.add_argument("value", nargs="?", help="status: 新ステータス / log: メモ")
    p.add_argument("--client")
    p.add_argument("--deadline", help="YYYY-MM-DD")
    p.add_argument("--price")
    p.add_argument("--platform", default="クラウドワークス")
    p.add_argument("--all", action="store_true", help="list: 完了・失注も表示")
    p.add_argument("--force", action="store_true", help="package: ERRORがあってもzip化")
    p.set_defaults(func=run)
