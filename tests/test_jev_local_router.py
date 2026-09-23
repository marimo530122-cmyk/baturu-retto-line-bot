"""ローカル用Jevツールのテスト。実際のAPIは呼ばない。

実行: python -m unittest discover tests
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import ai_router  # noqa: E402
import jev_local_router as cli  # noqa: E402


def run(argv, answer=None, error=None):
    calls = []

    def post(url, body, headers):
        calls.append(body)
        if error:
            raise error
        return {"answers": {"q": answer}}

    with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "k"}), mock.patch.object(ai_router, "_post_json", post):
        args = cli.parse_args(argv)
        return cli.run(args, args.text), calls


class JevLocalRouterTest(unittest.TestCase):
    def test_noul(self):
        result, calls = run(["noul", "愚痴か", "また値上げ"], {"type": "noul", "noul": 0.8})
        self.assertEqual(result, {"engine": "jev", "answer": True, "noul": 0.8, "fallback": False})
        self.assertEqual(calls[0]["state"], {"text": "また値上げ"})
        self.assertEqual(calls[0]["questions"]["q"], {"type": "noul", "instructions": "愚痴か"})

    def test_choice_sends_options_as_criteria(self):
        answer = {"type": "choice", "choice": "愚痴", "confidence": 0.9, "probabilities": {"愚痴": 0.9, "報告": 0.1}}
        result, calls = run(["choice", "種類は?", "値上げ", "--options", "愚痴", "報告"], answer)
        self.assertEqual(result["answer"], "愚痴")
        self.assertEqual(calls[0]["questions"]["q"]["criteria"], {"愚痴": None, "報告": None})

    def test_score_sends_levels_in_order(self):
        answer = {"type": "score", "score": 1.8, "confidence": 0.7}
        result, calls = run(["score", "急ぎ度", "明日朝", "--levels", "低", "中", "高"], answer)
        self.assertEqual(result["answer"], 1.8)
        self.assertEqual(calls[0]["questions"]["q"]["criteria"], ["低", "中", "高"])

    def test_route_low_confidence_goes_to_claude(self):
        answer = {"type": "choice", "choice": "jev", "confidence": 0.4, "probabilities": {}}
        result, _ = run(["route", "これ判定して"], answer)
        self.assertEqual(result["engine"], "claude")

    def test_route_confident_jev(self):
        answer = {"type": "choice", "choice": "jev", "confidence": 0.9, "probabilities": {}}
        result, calls = run(["route", "ネガティブか判定して"], answer)
        self.assertEqual(result["engine"], "jev")
        self.assertEqual(calls[0]["state"], {"request": "ネガティブか判定して"})

    def test_error_falls_back_to_claude(self):
        result, _ = run(["noul", "愚痴か", "x"], error=RuntimeError("HTTP 503"))
        self.assertEqual(result["engine"], "claude")
        self.assertTrue(result["fallback"])
        self.assertIn("HTTP 503", result["reason"])


if __name__ == "__main__":
    unittest.main()
