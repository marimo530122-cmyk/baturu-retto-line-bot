#!/usr/bin/env python3
"""ターミナルから Jev(TypeSafe)に1問だけ判定させるローカル用ツール。

「これってClaudeに聞くほどのことか?」という軽い判定(はい/いいえ・選択肢から1つ・段階評価)を
Claude を呼ばずに Jev で済ませるためのもの。結果は1行のJSONで返すので、シェルや他の
スクリプトから使いやすい。

Usage:
    # はい/いいえの確率
    python scripts/jev_local_router.py noul "この文は飲酒を強要しているか" "イッキ!イッキ!"
    # 選択肢から1つ
    python scripts/jev_local_router.py choice "このメモの種類は?" "仕入れ値がまた上がった" \\
        --options 愚痴 アイデア 報告
    # 段階評価(0から順に)
    python scripts/jev_local_router.py score "急ぎ度は?" "明日の朝までに発注" \\
        --levels 急がない 今週中 今日中
    # この依頼は Jev で済むか、Claude に回すべきか
    python scripts/jev_local_router.py route "このツイートがネガティブか判定して"

    判定対象のテキストは省略すると標準入力から読む:
    cat memo.txt | python scripts/jev_local_router.py noul "愚痴か"

キー未設定・通信エラーのときは {"engine": "claude", "fallback": true, ...} を返し、終了コード 0。
(「Jevで判定できなかった → 普通にClaudeに頼めばいい」という合図。処理を止めない)
"""

from __future__ import annotations

import argparse
import json
import sys

import ai_router

# route: 依頼内容を見て、Jevの判定だけで済むか、Claudeが必要かを決める
ROUTE_QUESTION = {
    "type": "choice",
    "instructions": "Which tool should handle this `request`?",
    "criteria": {
        "jev": (
            "A single simple judgment about given text: answer yes or no, pick one label "
            "from a short list, or rate it on a scale. No writing or explanation needed."
        ),
        "claude": (
            "Needs writing, coding, editing files, explaining, planning, research, "
            "or several steps of reasoning."
        ),
    },
}


def build_question(args: argparse.Namespace) -> dict:
    if args.kind == "noul":
        return {"type": "noul", "instructions": args.question}
    if args.kind == "choice":
        return {"type": "choice", "instructions": args.question, "criteria": {o: None for o in args.options}}
    return {"type": "score", "instructions": args.question, "criteria": args.levels}


def summarize(kind: str, answer: dict) -> dict:
    if kind == "noul":
        return {"answer": answer["noul"] >= 0.5, "noul": answer["noul"]}
    if kind == "choice":
        return {"answer": answer["choice"], "confidence": answer["confidence"], "probabilities": answer["probabilities"]}
    return {"answer": answer["score"], "confidence": answer["confidence"]}


def run(args: argparse.Namespace, text: str) -> dict:
    try:
        if args.kind == "route":
            answer = ai_router.jev_ask({"request": text}, {"q": ROUTE_QUESTION})["q"]
            engine, confidence = answer["choice"], answer["confidence"]
            if confidence < ai_router.MIN_CONFIDENCE:  # 迷ったらClaude
                engine = "claude"
            return {"engine": engine, "confidence": confidence, "fallback": False}
        answer = ai_router.jev_ask({"text": text}, {"q": build_question(args)})["q"]
        return {"engine": "jev", **summarize(args.kind, answer), "fallback": False}
    except Exception as err:  # キー未設定・通信エラー等はClaudeへ
        return {"engine": "claude", "fallback": True, "reason": str(err)}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Jevに1問だけ判定させる")
    sub = parser.add_subparsers(dest="kind", required=True)

    def add(name: str, help_text: str, with_question: bool = True) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_text)
        if with_question:
            p.add_argument("question", help="判定させたいこと")
        p.add_argument("text", nargs="?", help="判定対象のテキスト(省略時は標準入力)")
        return p

    add("noul", "はい/いいえの確率")
    add("choice", "選択肢から1つ").add_argument("--options", nargs="+", required=True)
    add("score", "段階評価(0から順)").add_argument("--levels", nargs="+", required=True)
    add("route", "Jevで済むかClaudeに回すか", with_question=False)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    text = args.text if args.text is not None else sys.stdin.read().strip()
    if not text:
        raise SystemExit("判定対象のテキストを引数か標準入力で渡してください。")
    print(json.dumps(run(args, text), ensure_ascii=False))


if __name__ == "__main__":
    main()
