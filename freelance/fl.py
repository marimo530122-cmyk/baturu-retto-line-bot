#!/usr/bin/env python3
"""クラウドワークス案件自動ハンター。指定キーワードに合う新着案件を集めて一覧ファイルにする。

Usage:
    python3 freelance/fl.py scrape-cw
    python3 freelance/fl.py scrape-cw --keyword スプレッドシート --keyword Excel
    python3 freelance/fl.py scrape-cw --min-reward 5000 --max-pages 2
    python3 freelance/fl.py scrape-cw --commit
    python3 freelance/fl.py scrape-cw --dump-html freelance/.debug

【重要】このスクリプトの検索URL・HTMLのCSSセレクタ(SELECTORS)は、実機のネットワークが使えない
開発環境で作成したため、実際のクラウドワークスのページに対して未検証です。
初回実行して0件しか取れない/様子がおかしい場合は、--dump-html で生HTMLを保存し、
SELECTORS を実際のDOM構造に合わせて調整してください。
"""

from __future__ import annotations

import argparse
import csv
import dataclasses
import datetime
import os
import re
import subprocess
import sys
import time
import urllib.robotparser
from typing import Optional

import requests
from bs4 import BeautifulSoup

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(REPO_ROOT, "freelance", "projects")
CSV_PATH = os.path.join(OUTPUT_DIR, "cw_latest_projects.csv")
HTML_PATH = os.path.join(OUTPUT_DIR, "cw_latest_projects.html")

BASE_URL = "https://crowdworks.jp"
# 要検証: 実際の公開検索ページのパス・クエリパラメータ名(2026年時点で未確認)
SEARCH_URL = BASE_URL + "/public/jobs/search"

# 自分のツールだと分かるように正直に名乗る(ブラウザを装って検知を回避したりはしない)
USER_AGENT = (
    "FreelanceHunterBot/1.0 (+personal job search tool, run manually by the account owner; "
    "contact via GitHub repo)"
)

DEFAULT_KEYWORDS = ["スプレッドシート", "Excel", "データ入力", "資料作成"]
# 対象外にしたい条件(案件タイトル・説明文にこれらの語が含まれていたら除外)
EXCLUDE_KEYWORDS = [
    "GAS必須",
    "Google Apps Script必須",
    "マクロ必須",
    "VBA必須",
    "常駐",
]
DEFAULT_MIN_REWARD = 3000  # 円。これ未満の案件は除外(報酬未記載の案件は除外しない)
REQUEST_INTERVAL_SEC = 1.5  # 相手サーバーへの配慮。ページ間・キーワード間で必ず空ける
REQUEST_TIMEOUT_SEC = 20

# 要検証: 実際のDOM構造に合わせて調整すること。カンマ区切りは「上から順に試して、
# 最初にヒットしたセレクタを使う」フォールバックリストのつもり。
SELECTORS = {
    "job_card": "li.job_offer, li[data-job-id], ul.job_offer_list > li, div.job_offer",
    "title": "h3, .job_offer_title, a.job_offer-title, .title",
    "link": "a",
    "reward": ".job_offer_price, .price, .reward, .job_offer-detail_price",
    "category": ".job_offer_category, .category",
}


@dataclasses.dataclass
class Project:
    title: str
    reward_text: str
    reward_value: Optional[int]
    category: str
    url: str
    matched_keyword: str
    scraped_at: str


def check_robots_allowed(user_agent: str, target_url: str) -> bool:
    """robots.txtで許可されているか確認する。取得自体に失敗した場合は安全側に倒して許可扱いにしない。"""
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(BASE_URL + "/robots.txt")
    try:
        parser.read()
    except Exception as e:
        print(f"警告: robots.txtの取得に失敗しました({e})。安全のため中断します。", file=sys.stderr)
        return False
    return parser.can_fetch(user_agent, target_url)


def reward_to_int(text: str) -> Optional[int]:
    """「3,000円〜10,000円」「時給1,200円〜」等の報酬表記から、判定に使う金額(最大値)を取り出す"""
    numbers = re.findall(r"[\d,]+", text)
    if not numbers:
        return None
    values = [int(n.replace(",", "")) for n in numbers if n.replace(",", "").isdigit()]
    return max(values) if values else None


def is_excluded(title: str, description: str) -> bool:
    combined = f"{title} {description}"
    return any(kw in combined for kw in EXCLUDE_KEYWORDS)


def fetch_search_html(keyword: str, page: int) -> Optional[str]:
    params = {"keyword": keyword, "order": "new", "page": page}
    headers = {"User-Agent": USER_AGENT}
    try:
        res = requests.get(SEARCH_URL, params=params, headers=headers, timeout=REQUEST_TIMEOUT_SEC)
        res.raise_for_status()
        return res.text
    except requests.RequestException as e:
        print(f"警告: '{keyword}' {page}ページ目の取得に失敗しました: {e}", file=sys.stderr)
        return None


def _select_first_match(el, selector_key: str):
    for sel in SELECTORS[selector_key].split(","):
        found = el.select_one(sel.strip())
        if found:
            return found
    return None


def parse_jobs(html_text: str, matched_keyword: str, scraped_at: str) -> list[Project]:
    soup = BeautifulSoup(html_text, "html.parser")
    cards = []
    for sel in SELECTORS["job_card"].split(","):
        cards = soup.select(sel.strip())
        if cards:
            break

    projects: list[Project] = []
    for card in cards:
        title_el = _select_first_match(card, "title")
        link_el = card.select_one(SELECTORS["link"])
        if not title_el or not link_el or not link_el.get("href"):
            continue

        title = title_el.get_text(strip=True)
        href = link_el["href"]
        url = href if href.startswith("http") else BASE_URL + href

        reward_el = _select_first_match(card, "reward")
        reward_text = reward_el.get_text(strip=True) if reward_el else ""

        category_el = _select_first_match(card, "category")
        category = category_el.get_text(strip=True) if category_el else ""

        description = card.get_text(" ", strip=True)
        if is_excluded(title, description):
            continue

        projects.append(
            Project(
                title=title,
                reward_text=reward_text,
                reward_value=reward_to_int(reward_text),
                category=category,
                url=url,
                matched_keyword=matched_keyword,
                scraped_at=scraped_at,
            )
        )
    return projects


def dedupe(projects: list[Project]) -> list[Project]:
    seen: dict[str, Project] = {}
    for p in projects:
        if p.url not in seen:
            seen[p.url] = p
    return list(seen.values())


def scrape(
    keywords: list[str],
    min_reward: int,
    max_pages: int,
    dump_html_dir: Optional[str] = None,
) -> list[Project]:
    scraped_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    all_projects: list[Project] = []

    if not check_robots_allowed(USER_AGENT, SEARCH_URL):
        raise SystemExit(
            "robots.txtにより、このURLへのアクセスが許可されていないようです。処理を中断します。"
        )

    if dump_html_dir:
        os.makedirs(dump_html_dir, exist_ok=True)

    for keyword in keywords:
        for page in range(1, max_pages + 1):
            html_text = fetch_search_html(keyword, page)
            time.sleep(REQUEST_INTERVAL_SEC)
            if html_text is None:
                continue

            if dump_html_dir:
                dump_path = os.path.join(dump_html_dir, f"{keyword}_page{page}.html")
                with open(dump_path, "w", encoding="utf-8") as f:
                    f.write(html_text)

            projects = parse_jobs(html_text, keyword, scraped_at)
            if not projects:
                print(
                    f"注意: '{keyword}' {page}ページ目から案件を0件しか抽出できませんでした。"
                    " ページ構造が想定と違う可能性があります(--dump-html で生HTMLを確認してください)。",
                    file=sys.stderr,
                )
            all_projects.extend(projects)

    filtered = [
        p for p in all_projects if p.reward_value is None or p.reward_value >= min_reward
    ]
    return dedupe(filtered)


def write_csv(projects: list[Project], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    projects_sorted = sorted(projects, key=lambda p: p.reward_value or 0, reverse=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["タイトル", "報酬", "カテゴリ", "マッチしたキーワード", "URL", "取得日時"])
        for p in projects_sorted:
            writer.writerow(
                [p.title, p.reward_text, p.category, p.matched_keyword, p.url, p.scraped_at]
            )


def write_html(projects: list[Project], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    projects_sorted = sorted(projects, key=lambda p: p.reward_value or 0, reverse=True)
    scraped_at = projects_sorted[0].scraped_at if projects_sorted else ""

    rows = "\n".join(
        f"""
        <a class="card" href="{p.url}" target="_blank" rel="noopener noreferrer">
          <div class="card-title">{p.title}</div>
          <div class="card-meta">
            <span class="reward">{p.reward_text or "報酬未記載"}</span>
            <span class="category">{p.category}</span>
            <span class="keyword">#{p.matched_keyword}</span>
          </div>
        </a>"""
        for p in projects_sorted
    )

    html_doc = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>クラウドワークス案件リスト</title>
<style>
  body {{ margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; background: #f9fafb; color: #111827; }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  .updated {{ font-size: 12px; color: #6b7280; margin-bottom: 16px; }}
  .card {{ display: block; background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; text-decoration: none; color: inherit; }}
  .card-title {{ font-size: 14px; font-weight: 600; margin-bottom: 6px; }}
  .card-meta {{ display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #4b5563; }}
  .reward {{ color: #b91c1c; font-weight: 600; }}
  .keyword {{ color: #2563eb; }}
</style>
</head>
<body>
  <h1>クラウドワークス案件リスト</h1>
  <div class="updated">最終取得: {scraped_at}(全{len(projects_sorted)}件)</div>
  {rows if projects_sorted else '<p>該当する案件はありませんでした。</p>'}
</body>
</html>
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(html_doc)


def commit_and_push(paths: list[str]) -> None:
    rel_paths = [os.path.relpath(p, REPO_ROOT) for p in paths]
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=REPO_ROOT, check=True)
    subprocess.run(
        ["git", "config", "user.email", "github-actions[bot]@users.noreply.github.com"],
        cwd=REPO_ROOT,
        check=True,
    )
    subprocess.run(["git", "add", *rel_paths], cwd=REPO_ROOT, check=True)
    result = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO_ROOT)
    if result.returncode == 0:
        print("変更なし(前回と同じ内容のため、コミットはスキップしました)")
        return
    subprocess.run(
        ["git", "commit", "-m", "Update CrowdWorks project list"], cwd=REPO_ROOT, check=True
    )
    subprocess.run(["git", "push"], cwd=REPO_ROOT, check=True)


def run_scrape_cw(args: argparse.Namespace) -> None:
    keywords = args.keyword or DEFAULT_KEYWORDS
    projects = scrape(
        keywords=keywords,
        min_reward=args.min_reward,
        max_pages=args.max_pages,
        dump_html_dir=args.dump_html,
    )

    write_csv(projects, CSV_PATH)
    write_html(projects, HTML_PATH)
    print(f"{len(projects)}件の案件を抽出しました。")
    print(f"Wrote {os.path.relpath(CSV_PATH, REPO_ROOT)}")
    print(f"Wrote {os.path.relpath(HTML_PATH, REPO_ROOT)}")

    if args.commit:
        commit_and_push([CSV_PATH, HTML_PATH])
        print("Committed and pushed.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scrape_cw = subparsers.add_parser("scrape-cw", help="クラウドワークスの新着案件を集めて一覧を作る")
    scrape_cw.add_argument(
        "--keyword",
        action="append",
        help=f"検索キーワード(複数指定可)。省略時は既定のキーワード({', '.join(DEFAULT_KEYWORDS)})を使う",
    )
    scrape_cw.add_argument("--min-reward", type=int, default=DEFAULT_MIN_REWARD, help="この金額未満の案件を除外する(円)")
    scrape_cw.add_argument("--max-pages", type=int, default=1, help="キーワードごとに何ページ分取得するか")
    scrape_cw.add_argument("--commit", action="store_true", help="生成後にgit add/commit/pushまで行う")
    scrape_cw.add_argument(
        "--dump-html", metavar="DIR", help="デバッグ用に、取得した生HTMLをこのディレクトリに保存する"
    )

    args = parser.parse_args()
    if args.command == "scrape-cw":
        run_scrape_cw(args)


if __name__ == "__main__":
    main()
