"""⑨ ビジネス文章・提案文ジェネレーター: クライアントとのやり取りを定型+AIで作成する。

templates/messages/<種類>.md のテンプレートに --set で値を差し込む。埋まっていない項目は
【要入力:項目名】として残す(⑧チェッカーが ERROR として検出するので送信事故を防げる)。

--ai を付けると、案件本文(--job)を読んだ Claude が、テンプレートの構成を守りつつ
その案件専用の文面に書き直す(ANTHROPIC_API_KEY が必要。失敗時はテンプレート文面のまま)。

例:
  python fl.py write proposal --set client=山田 --set job_title="売上管理表の作成" --set price="15,000円(税込)"
  python fl.py write proposal --ai --job 01_brief/job.txt --set client=山田 -o 04_delivery/応募文.txt
"""

from __future__ import annotations

import re
from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "messages"
MODEL = "claude-opus-5"
KINDS = {
    "proposal": "応募・提案文",
    "question": "作業前の質問・確認",
    "kickoff": "受注御礼・着手連絡",
    "progress": "進捗報告",
    "delivery": "納品連絡",
    "revision": "修正対応の連絡",
    "thanks": "検収お礼・評価依頼",
}
DEFAULTS = {"my_name": "(あなたの名前)", "report_timing": "作業の中間地点", "revision_policy": "納品後7日以内の修正は無料で対応いたします。"}


def fill(kind: str, values: dict) -> str:
    text = (TEMPLATE_DIR / f"{kind}.md").read_text(encoding="utf-8")
    merged = {**DEFAULTS, **values}
    return re.sub(r"\{(\w+)\}", lambda m: merged.get(m.group(1)) or f"【要入力:{m.group(1)}】", text)


def ai_rewrite(kind: str, draft: str, job_text: str, extra: str | None) -> str | None:
    try:
        import anthropic
    except ImportError:
        print("[write] anthropic が未インストールのためテンプレート文面を使います")
        return None
    system = (
        "あなたはクラウドソーシング(クラウドワークス等)で受託業務をしているフリーランスの文章アシスタントです。"
        "丁寧だが堅すぎない日本語のビジネス文面を書きます。誇張・虚偽の実績・確約できない約束は書きません。"
        "【要入力:…】と書かれた箇所は、案件情報から確実に分かる場合だけ埋め、分からなければそのまま残してください。"
        "出力は送信する文面そのものだけにしてください(前置きや解説は不要)。"
    )
    user = (
        f"# 文面の種類\n{KINDS[kind]}\n\n# 案件情報\n{job_text or '(なし)'}\n\n"
        f"# 追加の指示\n{extra or '(なし)'}\n\n# 下書き(この構成を基本に、案件に合わせて具体的に書き直す)\n{draft}"
    )
    client = anthropic.Anthropic()
    try:
        # 安全分類器による拒否時はサーバー側で別モデルへ自動フォールバック
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APIStatusError as e:
        print(f"[write] Claude API エラー({e.status_code})。テンプレート文面を使います")
        return None
    except anthropic.APIConnectionError:
        print("[write] Claude API に接続できません。テンプレート文面を使います")
        return None
    if response.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    return text or None


def run(args) -> int:
    if args.list:
        for k, v in KINDS.items():
            fields = sorted(set(re.findall(r"\{(\w+)\}", (TEMPLATE_DIR / f"{k}.md").read_text(encoding="utf-8"))))
            print(f"{k:10s} {v}  項目: {', '.join(fields)}")
        return 0
    if not args.kind:
        raise SystemExit("種類を指定してください(--list で一覧)")
    values = dict(s.split("=", 1) for s in (args.set or []))
    text = fill(args.kind, values)
    if args.ai:
        job = Path(args.job).read_text(encoding="utf-8") if args.job else ""
        text = ai_rewrite(args.kind, text, job, args.instruction) or text
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"[write] 保存しました: {args.out}")
    print(text)
    missing = re.findall(r"【要入力:(\w+)】", text)
    if missing:
        print(f"\n[write] ⚠ 未入力の項目: {', '.join(dict.fromkeys(missing))}(--set 項目=値 で指定)")
    return 0


def register(sub) -> None:
    p = sub.add_parser("write", help="⑨ 応募文・質問・納品連絡などのビジネス文面を作成")
    p.add_argument("kind", nargs="?", choices=list(KINDS))
    p.add_argument("--list", action="store_true", help="テンプレート一覧と項目を表示")
    p.add_argument("--set", action="append", help="項目=値(複数可)")
    p.add_argument("--ai", action="store_true", help="Claude で案件に合わせて書き直す")
    p.add_argument("--job", help="案件本文のテキストファイル(--ai 用)")
    p.add_argument("--instruction", help="AIへの追加指示(例: 短めに、実績を強調)")
    p.add_argument("-o", "--out")
    p.set_defaults(func=run)
