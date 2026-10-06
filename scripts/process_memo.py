#!/usr/bin/env python3
"""Take a raw memo (phone dump) and turn it into a structured daily-log Markdown file.

Usage:
    python scripts/process_memo.py "今日のメモ本文..."
    python scripts/process_memo.py --file memo.txt
    echo "メモ本文" | python scripts/process_memo.py
    MEMO_TEXT="メモ本文" python scripts/process_memo.py --commit
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import subprocess
import sys

import anthropic

import ai_router

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(REPO_ROOT, "docs", "daily-logs")

SYSTEM_PROMPT = """\
あなたは、現役魚屋(48歳)が日々スマホに吐き出す愚痴や気づき、AI自動化の試行錯誤の \
生メモを、後からコンテンツ化(ショート動画・SNS投稿・ブログ)しやすい形に整理する \
編集アシスタントです。

入力されるメモは口語的で、事実と感情が入り混じっていることが多いです。 \
これを脚色・誇張せず、事実を捏造せずに、以下のJSONスキーマで出力してください。 \
出力はJSONオブジェクト1つのみとし、前後に説明文やMarkdownのコードフェンスを付けないこと。

{
  "hook_titles": ["フック用タイトル案を3つ、短くインパクトのある表現で"],
  "tags": ["検索・分類用のタグを3〜6個、日本語の短いキーワードで"],
  "primary_doc": "事実(何が起きたか)と感情(何を感じたか)を分けて書いた一次ドキュメント。Markdownの小見出し(#### 事実 / #### 感情)を使ってよい。",
  "stock_summary": "検索・再利用しやすい箇条書きの要約。Markdownの箇条書き(- )形式。"
}
"""

# Geminiに回すのは「まだ形になっていないアイデア・相談」。壁打ち相手として論点も出させる
GEMINI_ADDENDUM = """
このメモはまだ形になっていないアイデアや相談ごとです。stock_summary の最後に \
「#### 壁打ちメモ」という小見出しを付け、検討すべき論点と次に試せることを箇条書きで \
3つ程度加えてください。
"""


def get_memo_text(args: argparse.Namespace) -> str:
    if args.text:
        return args.text
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            return f.read().strip()
    env_text = os.environ.get("MEMO_TEXT")
    if env_text:
        return env_text.strip()
    if not sys.stdin.isatty():
        piped = sys.stdin.read().strip()
        if piped:
            return piped
    raise SystemExit(
        "メモ本文が指定されていません。引数、--file、MEMO_TEXT環境変数、標準入力のいずれかで渡してください。"
    )


def classify_memo(raw_text: str) -> dict:
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": raw_text}],
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    return json.loads(text)


def structure_without_ai(raw_text: str) -> dict:
    """テスト送信など中身のないメモ用。LLMを呼ばずに最低限の形だけ作る。"""
    first_line = raw_text.strip().splitlines()[0] if raw_text.strip() else "memo"
    return {
        "hook_titles": [first_line[:30]],
        "tags": ["未整形"],
        "primary_doc": "(中身の少ないメモと判定されたため、AI整形はスキップしました)",
        "stock_summary": "- 元メモを参照",
    }


def structure_memo(raw_text: str) -> tuple[dict, str]:
    """Jevの判定に従ってClaude / Gemini / AIなしに振り分ける。戻り値は(整形結果, route表記)。"""
    route = ai_router.route_memo(raw_text)
    print(f"Route: {route.label} (confidence {route.confidence:.2f}) - {route.reason}")

    if route.engine == "skip":
        return structure_without_ai(raw_text), route.label
    if route.engine == "gemini":
        try:
            return (
                ai_router.gemini_generate_json(SYSTEM_PROMPT + GEMINI_ADDENDUM, raw_text),
                route.label,
            )
        except Exception as err:
            print(f"Gemini整形に失敗したためClaudeで処理します: {err}", file=sys.stderr)
    return classify_memo(raw_text), f"{route.kind} → claude"


def slugify(title: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^\w\-]+", "-", title, flags=re.UNICODE).strip("-")
    return slug[:max_len] if slug else "memo"


def render_markdown(
    raw_text: str, parsed: dict, timestamp: datetime.datetime, route: str
) -> str:
    hook_titles = parsed.get("hook_titles") or ["(タイトル未生成)"]
    tags = parsed.get("tags") or []
    primary_doc = parsed.get("primary_doc", "").strip()
    stock_summary = parsed.get("stock_summary", "").strip()

    hook_list = "\n".join(f"- {t}" for t in hook_titles)

    return f"""# {hook_titles[0]}

- date: {timestamp.strftime("%Y-%m-%d %H:%M")} UTC
- tags: {", ".join(tags)}
- route: {route}

## ① ショート動画・フック用タイトル
{hook_list}

## ② 一次情報ドキュメント(事実と感情)
{primary_doc}

## ③ GitHub/ストック用Markdownデータ
{stock_summary}

---
### 元メモ(生データ)
{raw_text}
"""


def write_log_file(content: str, hook_title: str, timestamp: datetime.datetime) -> str:
    os.makedirs(LOG_DIR, exist_ok=True)
    filename = f"{timestamp.strftime('%Y-%m-%d-%H%M%S')}-{slugify(hook_title)}.md"
    path = os.path.join(LOG_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def commit_and_push(path: str) -> None:
    rel_path = os.path.relpath(path, REPO_ROOT)
    subprocess.run(
        ["git", "config", "user.name", "github-actions[bot]"], cwd=REPO_ROOT, check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "github-actions[bot]@users.noreply.github.com"],
        cwd=REPO_ROOT,
        check=True,
    )
    subprocess.run(["git", "add", rel_path], cwd=REPO_ROOT, check=True)
    subprocess.run(
        ["git", "commit", "-m", f"Add daily log: {rel_path}"], cwd=REPO_ROOT, check=True
    )
    subprocess.run(["git", "push"], cwd=REPO_ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", nargs="?", help="メモ本文を直接指定する")
    parser.add_argument("--file", help="メモ本文が書かれたファイルパス")
    parser.add_argument(
        "--commit", action="store_true", help="生成後にgit add/commit/pushまで行う"
    )
    args = parser.parse_args()

    raw_text = get_memo_text(args)
    parsed, route = structure_memo(raw_text)
    timestamp = datetime.datetime.now(datetime.timezone.utc)
    content = render_markdown(raw_text, parsed, timestamp, route)
    hook_title = (parsed.get("hook_titles") or ["memo"])[0]
    path = write_log_file(content, hook_title, timestamp)
    print(f"Wrote {path}")

    if args.commit:
        commit_and_push(path)
        print("Committed and pushed.")


if __name__ == "__main__":
    main()
