"""Multi-AI router: Jev decides where a memo goes, Claude / Gemini do the heavy lifting.

役割分担:
    Jev (TypeSafe)  … 判定だけ。メモの種類を選択肢から1つ選ぶ(文章は書かない・激安・高速)
    Claude          … 本気の整形。魚屋の日常エピソードやAI自動化の試行錯誤メモ
    Gemini          … 壁打ち・分析。まだ形になっていないアイデアや相談ごと
    (AIなし)        … テスト送信などの中身のないメモ。LLMを呼ばずに生データだけ保存

どのキーが無くても・どのAPIが失敗しても、最終的には今まで通りClaudeで処理する
(= 司令塔が壊れてもメモ取り込みは止まらない)。

HTTPは標準ライブラリ(urllib)だけで叩くので、追加の依存パッケージは不要。
Jev APIの仕様: https://docs.typesafe.ai/api (公式SDK typesafe-sdk 0.7.1 と同じリクエスト形式)
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

TYPESAFE_BASE_URL = os.environ.get("TYPESAFE_BASE_URL", "https://api.typesafe.ai").rstrip("/")
JEV_MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

# Jevの確信度がこれ未満なら、迷わずClaude(今まで通りの処理)に回す
MIN_CONFIDENCE = float(os.environ.get("ROUTE_MIN_CONFIDENCE", "0.6"))
# 「中身なし」でAIを完全に飛ばすのは、これ以上確信があるときだけ(取りこぼし防止)
SKIP_MIN_CONFIDENCE = float(os.environ.get("ROUTE_SKIP_MIN_CONFIDENCE", "0.85"))

HTTP_TIMEOUT = 30

# Jevへの質問。choiceのラベル → 担当エンジン
MEMO_KIND_QUESTION = {
    "type": "choice",
    "instructions": (
        "A 48-year-old fishmonger dumped this memo from a phone. "
        "What kind of memo is it?"
    ),
    "criteria": {
        "story": (
            "An episode from the fish shop or daily life: a complaint, a hectic moment, "
            "a customer, family or supplier event, or feelings about the work."
        ),
        "tech": (
            "Notes about trying AI tools, automation, programming, bots or apps, "
            "including bugs, things that worked or failed, and features to build."
        ),
        "idea": (
            "A rough business, content or marketing idea, a question, or a plan to think "
            "through, without a concrete episode that already happened."
        ),
        "noise": (
            "Not a real memo: a test message, a few random characters, "
            "or text with nothing to organize."
        ),
    },
}

ENGINE_BY_KIND = {
    "story": "claude",
    "tech": "claude",  # 実装候補。ログに route: tech が残るので、後でClaude Codeに渡しやすい
    "idea": "gemini",
    "noise": "skip",
}


@dataclass
class Route:
    engine: str  # "claude" | "gemini" | "skip"
    kind: str  # Jevが選んだラベル。Jevを使わなかったときは "-"
    confidence: float
    reason: str

    @property
    def label(self) -> str:
        return f"{self.kind} → {self.engine}"


def _post_json(url: str, body: dict, headers: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"HTTP {err.code} from {url}: {detail}") from err


def jev_ask(state, questions: dict) -> dict:
    """Jev(System One)に質問をまとめて投げ、質問名 → 回答 の辞書を返す。"""
    api_key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("TYPESAFE_API_KEY が設定されていません")
    data = _post_json(
        f"{TYPESAFE_BASE_URL}/v1/systemone",
        {"state": state, "model": JEV_MODEL, "questions": questions},
        {"Authorization": f"Bearer {api_key}"},
    )
    return data["answers"]


def route_memo(raw_text: str) -> Route:
    """メモをどのAIに回すかをJevで決める。判断できないときは必ずClaude。"""
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        return Route("claude", "-", 0.0, "TYPESAFE_API_KEY未設定のため従来どおりClaude")
    try:
        answer = jev_ask({"memo": raw_text}, {"kind": MEMO_KIND_QUESTION})["kind"]
        kind, confidence = answer["choice"], float(answer["confidence"])
    except Exception as err:  # Jevが落ちてもメモ取り込みは止めない
        return Route("claude", "-", 0.0, f"Jev判定に失敗したためClaude: {err}")

    engine = ENGINE_BY_KIND.get(kind, "claude")
    if confidence < MIN_CONFIDENCE:
        return Route("claude", kind, confidence, "確信度が低いためClaude")
    if engine == "skip" and confidence < SKIP_MIN_CONFIDENCE:
        return Route("claude", kind, confidence, "中身なし判定だが確信度が足りないためClaude")
    if engine == "gemini" and not os.environ.get("GEMINI_API_KEY", "").strip():
        return Route("claude", kind, confidence, "GEMINI_API_KEY未設定のためClaude")
    return Route(engine, kind, confidence, "Jev判定どおり")


def gemini_generate_json(system_prompt: str, user_text: str) -> dict:
    """GeminiにJSONだけを返させる(壁打ち・分析担当)。"""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY が設定されていません")
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        },
        {"x-goog-api-key": api_key},
    )
    parts = data["candidates"][0]["content"]["parts"]
    return json.loads("".join(part.get("text", "") for part in parts))
