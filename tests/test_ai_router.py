"""Jevルーティングのテスト。実際のAPIは呼ばず HTTP 部分を差し替える。

実行: python -m unittest discover tests
"""

import json
import os
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
# anthropic 未インストールの環境でも process_memo を読み込めるようにする(Claudeは呼ばない)
sys.modules.setdefault("anthropic", types.ModuleType("anthropic"))

import ai_router  # noqa: E402
import process_memo  # noqa: E402

GEMINI_RESULT = {"hook_titles": ["G"], "tags": ["t"], "primary_doc": "p", "stock_summary": "- s"}
CLAUDE_RESULT = {"hook_titles": ["C"], "tags": [], "primary_doc": "", "stock_summary": ""}


def fake_post(kind, confidence):
    calls = []

    def post(url, body, headers):
        calls.append((url, body, headers))
        if "typesafe" in url:
            return {"answers": {"kind": {"type": "choice", "choice": kind, "confidence": confidence}}}
        return {"candidates": [{"content": {"parts": [{"text": json.dumps(GEMINI_RESULT)}]}}]}

    return post, calls


class StructureMemoTest(unittest.TestCase):
    def run_route(self, env, kind="story", confidence=0.9):
        post, calls = fake_post(kind, confidence)
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
            ai_router, "_post_json", post
        ), mock.patch.object(process_memo, "classify_memo", return_value=CLAUDE_RESULT):
            parsed, route = process_memo.structure_memo("テスト")
        return parsed, route, calls

    def test_no_key_uses_claude_without_calling_jev(self):
        parsed, route, calls = self.run_route({})
        self.assertEqual((parsed, route, calls), (CLAUDE_RESULT, "- → claude", []))

    def test_story_goes_to_claude(self):
        parsed, route, calls = self.run_route({"TYPESAFE_API_KEY": "k"}, "story")
        self.assertEqual((parsed, route), (CLAUDE_RESULT, "story → claude"))
        url, body, headers = calls[0]
        self.assertEqual(url, "https://api.typesafe.ai/v1/systemone")
        self.assertEqual(headers, {"Authorization": "Bearer k"})
        self.assertEqual(body["state"], {"memo": "テスト"})
        self.assertEqual(body["model"], "jev-latest")

    def test_idea_goes_to_gemini(self):
        parsed, route, _ = self.run_route({"TYPESAFE_API_KEY": "k", "GEMINI_API_KEY": "g"}, "idea")
        self.assertEqual((parsed, route), (GEMINI_RESULT, "idea → gemini"))

    def test_idea_without_gemini_key_falls_back_to_claude(self):
        parsed, route, _ = self.run_route({"TYPESAFE_API_KEY": "k"}, "idea")
        self.assertEqual((parsed, route), (CLAUDE_RESULT, "idea → claude"))

    def test_confident_noise_skips_ai(self):
        parsed, route, _ = self.run_route({"TYPESAFE_API_KEY": "k"}, "noise", 0.95)
        self.assertEqual(route, "noise → skip")
        self.assertEqual(parsed["tags"], ["未整形"])

    def test_unsure_noise_still_uses_claude(self):
        _, route, _ = self.run_route({"TYPESAFE_API_KEY": "k"}, "noise", 0.7)
        self.assertEqual(route, "noise → claude")

    def test_low_confidence_uses_claude(self):
        _, route, _ = self.run_route({"TYPESAFE_API_KEY": "k", "GEMINI_API_KEY": "g"}, "idea", 0.4)
        self.assertEqual(route, "idea → claude")

    def test_jev_failure_uses_claude(self):
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "k"}, clear=True), mock.patch.object(
            ai_router, "_post_json", side_effect=RuntimeError("HTTP 503")
        ):
            route = ai_router.route_memo("テスト")
        self.assertEqual(route.engine, "claude")
        self.assertIn("HTTP 503", route.reason)


if __name__ == "__main__":
    unittest.main()
