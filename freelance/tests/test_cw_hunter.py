import html
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cw_hunter  # noqa: E402


def entry(job_id, title, description, payment, client="テスト商事"):
    return {"job_offer": {"id": job_id, "title": title, "description_digest": description},
            "payment": payment,
            "client": {"id": 900 + job_id, "username": client}}


SEARCH_DATA = {
    "searchResult": {
        "job_offers": [
            entry(1, "【急募】Excelの売上データ整理と集計表作成", "スプレッドシートに転記して月別に集計してください",
                  {"fixed_price_payment": {"min_budget": 10000, "max_budget": 30000}}, client="山田商店"),
            entry(2, "Excelマクロ作成", "VBAで自動化をお願いします",
                  {"fixed_price_payment": {"min_budget": 50000, "max_budget": 50000}}),
            entry(3, "データ入力（スマホ1台で）", "LINE登録後に詳細をお伝えします",
                  {"fixed_price_payment": {"min_budget": 5000, "max_budget": 5000}}),
            entry(4, "簡単なデータ入力", "1件ずつ入力",
                  {"task_payment": {"task_price": 10}}),
            entry(5, "PowerPoint資料の清書", "手書きの原稿をパワポにまとめる",
                  {"hourly_payment": {"min_hourly_wage": 1200, "max_hourly_wage": 1500}}),
        ]
    }
}

JSON_PAGE = (
    '<html><body><div id="vue-container" data="'
    + html.escape(json.dumps(SEARCH_DATA, ensure_ascii=False), quote=True)
    + '"></div></body></html>'
)

LINK_PAGE = """
<html><body>
<a href="/public/jobs/111">Excel表の作成</a>
<a href="/public/jobs/111">Excel表の作成</a>
<a href="/public/jobs/222?ref=list">議事録の清書</a>
<a href="/public/jobs/search?page=2">次へ</a>
</body></html>
"""


class ParseTest(unittest.TestCase):
    def test_reads_embedded_json(self):
        jobs = {j["id"]: j for j in cw_hunter.parse_search_page(JSON_PAGE)}
        self.assertEqual(set(jobs), {"1", "2", "3", "4", "5"})
        self.assertEqual(jobs["1"]["url"], "https://crowdworks.jp/public/jobs/1")
        self.assertEqual((jobs["1"]["budget_min"], jobs["1"]["budget_max"]), (10000, 30000))
        self.assertEqual(jobs["4"]["payment_type"], "タスク")
        self.assertEqual(jobs["5"]["payment_type"], "時間単価")
        self.assertEqual(jobs["1"]["client"], "山田商店")

    def test_falls_back_to_links(self):
        jobs = cw_hunter.parse_search_page(LINK_PAGE)
        self.assertEqual([(j["id"], j["title"]) for j in jobs],
                         [("111", "Excel表の作成"), ("222", "議事録の清書")])
        self.assertIsNone(jobs[0]["budget_max"])
        self.assertEqual(jobs[0]["client"], "不明")


class EvaluateTest(unittest.TestCase):
    def setUp(self):
        self.config = cw_hunter.load_config()
        self.jobs = {j["id"]: cw_hunter.evaluate(j, self.config)
                     for j in cw_hunter.parse_search_page(JSON_PAGE)}

    def test_good_job_passes_with_score(self):
        job = self.jobs["1"]
        self.assertFalse(job["excluded"])
        self.assertGreaterEqual(job["score"], self.config["min_score"])
        self.assertEqual(job["budget_text"], "10,000〜30,000円")

    def test_macro_job_excluded(self):
        self.assertTrue(self.jobs["2"]["excluded"])
        self.assertIn("マクロ必須", self.jobs["2"]["reasons"])

    def test_scam_like_job_excluded(self):
        self.assertTrue(self.jobs["3"]["excluded"])
        self.assertIn("要注意案件", self.jobs["3"]["reasons"])

    def test_low_budget_task_excluded(self):
        self.assertTrue(self.jobs["4"]["excluded"])
        self.assertIn("報酬が低い", self.jobs["4"]["reasons"])

    def test_hourly_job_passes(self):
        self.assertFalse(self.jobs["5"]["excluded"])
        self.assertEqual(self.jobs["5"]["budget_text"], "1,200〜1,500円/時")


class SearchPhraseTest(unittest.TestCase):
    def test_strips_decoration_and_keeps_core(self):
        self.assertEqual(cw_hunter.make_search_phrase("【急募】Excelの売上データ整理と集計表作成"),
                         "Excelの売上データ整理と集計表作成")
        self.assertEqual(cw_hunter.make_search_phrase("★初心者歓迎★ PowerPoint資料の清書"),
                         "初心者歓迎 PowerPoint資料の清書")

    def test_joins_short_parts(self):
        self.assertEqual(cw_hunter.make_search_phrase("[長期] 議事録 清書"), "議事録 清書")

    def test_length_is_capped(self):
        self.assertLessEqual(len(cw_hunter.make_search_phrase("あ" * 60)), 25)


class OutputTest(unittest.TestCase):
    def test_csv_columns_in_required_order(self):
        import csv
        import tempfile
        config = cw_hunter.load_config()
        jobs = [cw_hunter.evaluate(j, config) for j in cw_hunter.parse_search_page(JSON_PAGE)]
        for j in jobs:
            j["new"] = "★"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.csv"
            cw_hunter.write_csv(path, jobs)
            with open(path, encoding="utf-8-sig", newline="") as f:
                rows = list(csv.reader(f))
        self.assertEqual(rows[0], ["新着★", "点数", "クライアント名", "案件タイトル",
                                   "💡一発検索用コピペワード", "報酬", "形式", "URL", "判定理由"])
        first = dict(zip(rows[0], rows[1]))
        self.assertEqual(first["クライアント名"], "山田商店")
        self.assertEqual(first["💡一発検索用コピペワード"], "Excelの売上データ整理と集計表作成")


class RobotsTest(unittest.TestCase):
    def test_disallowed_url_is_not_fetched(self):
        import urllib.robotparser
        robots = urllib.robotparser.RobotFileParser()
        robots.parse(["User-agent: *", "Disallow: /public/jobs/search"])
        with self.assertRaises(cw_hunter.FetchBlocked):
            cw_hunter.fetch(cw_hunter.search_url("Excel"), robots)


if __name__ == "__main__":
    unittest.main()
