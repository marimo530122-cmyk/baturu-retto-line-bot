"""⑥ Webデータ収集・スクレイピング基盤: リサーチ・リスト作成案件の自動化。

- robots.txt を確認し、禁止されているURLは取得しない。
- リクエスト間隔(既定2秒)を必ず空ける。サーバーに負荷をかけない。
- 結果は Excel でそのまま開ける UTF-8(BOM付き)CSV で保存。

例:
  # 一覧ページの .item ごとに、名前・価格・リンクを抜く(2〜5ページ目まで)
  python fl.py scrape "https://example.com/list?page={page}" --pages 1-5 \\
      --item ".item" --field "名前=h2" --field "価格=.price" --field "URL=a@href" -o out.csv
  # ページ内のリンク・見出し・表をざっと確認する
  python fl.py scrape https://example.com --inspect

利用規約でスクレイピングを禁止しているサイト、ログインが必要なページ、個人情報の収集は対象外。
案件を受ける前に対象サイトの規約を確認すること。
"""

from __future__ import annotations

import csv
import time
import urllib.robotparser
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .common import ensure_parent

UA = "Mozilla/5.0 (compatible; fl-research-bot/1.0)"
_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def allowed(url: str) -> bool:
    base = "{0.scheme}://{0.netloc}".format(urlparse(url))
    if base not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        try:
            resp = requests.get(base + "/robots.txt", headers={"User-Agent": UA}, timeout=15)
            if resp.status_code >= 400:
                _robots_cache[base] = None  # robots.txt が無い=制限なし
            else:
                rp.parse(resp.text.splitlines())
                _robots_cache[base] = rp
        except requests.RequestException:
            _robots_cache[base] = None
    rp = _robots_cache[base]
    return True if rp is None else rp.can_fetch(UA, url)


def fetch(url: str, delay: float) -> BeautifulSoup | None:
    if not allowed(url):
        print(f"[scrape] robots.txt で禁止されているためスキップ: {url}")
        return None
    for attempt in range(3):
        try:
            resp = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            if resp.status_code == 429 or resp.status_code >= 500:
                time.sleep(delay * (attempt + 2))
                continue
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding if resp.encoding in (None, "ISO-8859-1") else resp.encoding
            time.sleep(delay)
            return BeautifulSoup(resp.text, "html.parser")
        except requests.RequestException as e:
            print(f"[scrape] 取得失敗({attempt + 1}/3): {url} {e}")
            time.sleep(delay * (attempt + 1))
    return None


def _extract(node, selector: str, base_url: str) -> str:
    """'セレクタ' または 'セレクタ@属性'。セレクタ省略('@href')はノード自身。"""
    sel, _, attr = selector.partition("@")
    target = node.select_one(sel) if sel else node
    if target is None:
        return ""
    if attr:
        val = target.get(attr, "")
        return urljoin(base_url, val) if attr in ("href", "src") and val else val
    return " ".join(target.get_text(" ", strip=True).split())


def expand_urls(url: str, pages: str | None) -> list[str]:
    if not pages or "{page}" not in url:
        return [url]
    a, _, b = pages.partition("-")
    return [url.replace("{page}", str(i)) for i in range(int(a), int(b or a) + 1)]


def scrape(urls: list[str], item: str | None, fields: dict[str, str], delay: float) -> list[dict]:
    rows = []
    for url in urls:
        soup = fetch(url, delay)
        if soup is None:
            continue
        nodes = soup.select(item) if item else [soup]
        for node in nodes:
            row = {name: _extract(node, sel, url) for name, sel in fields.items()}
            if any(row.values()):
                row["取得元URL"] = url
                rows.append(row)
        print(f"[scrape] {url} → {len(nodes)}件")
    return rows


def inspect(url: str, delay: float) -> None:
    soup = fetch(url, delay)
    if soup is None:
        return
    print(f"タイトル: {soup.title.get_text(strip=True) if soup.title else ''}")
    for tag in ("h1", "h2", "h3"):
        for h in soup.select(tag)[:10]:
            print(f"  <{tag}> {h.get_text(strip=True)[:80]}")
    tables = soup.select("table")
    print(f"表: {len(tables)}個")
    classes: dict[str, int] = {}
    for el in soup.find_all(class_=True):
        for c in el.get("class", []):
            classes[c] = classes.get(c, 0) + 1
    print("繰り返し要素の候補(class出現回数 上位): ")
    for c, n in sorted(classes.items(), key=lambda x: -x[1])[:15]:
        print(f"  .{c} × {n}")
    print(f"リンク: {len(soup.select('a[href]'))}本")


def save_csv(rows: list[dict], out: str) -> None:
    if not rows:
        print("[scrape] 取得件数0件。セレクタを --inspect で確認してください")
        return
    headers = list(dict.fromkeys(k for r in rows for k in r))
    with open(ensure_parent(out), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)
    print(f"[scrape] {len(rows)}件を保存: {out}")


def run(args) -> int:
    if args.inspect:
        inspect(args.url, args.delay)
        return 0
    if args.tables:
        import pandas as pd
        from io import StringIO

        soup = fetch(args.url, args.delay)
        if soup is None:
            return 1
        for i, t in enumerate(pd.read_html(StringIO(str(soup))), 1):
            path = args.out.replace(".csv", f"_{i}.csv")
            t.to_csv(ensure_parent(path), index=False, encoding="utf-8-sig")
            print(f"[scrape] 表{i}: {len(t)}行 → {path}")
        return 0
    fields = dict(f.split("=", 1) for f in args.field) if args.field else {"テキスト": "", "リンク": "a@href"}
    save_csv(scrape(expand_urls(args.url, args.pages), args.item, fields, args.delay), args.out)
    return 0


def register(sub) -> None:
    p = sub.add_parser("scrape", help="⑥ Webページからデータ収集(robots.txt遵守)")
    p.add_argument("url", help="対象URL。{page} を含めると --pages で連番展開")
    p.add_argument("--pages", help='ページ範囲 例: "1-5"')
    p.add_argument("--item", help="繰り返し要素のCSSセレクタ(例: .card)")
    p.add_argument("--field", action="append", help='列名=セレクタ[@属性] 例: "価格=.price" "URL=a@href"')
    p.add_argument("--tables", action="store_true", help="ページ内の<table>を全部CSV化")
    p.add_argument("--inspect", action="store_true", help="ページ構造をざっと表示(セレクタ探し用)")
    p.add_argument("--delay", type=float, default=2.0, help="リクエスト間隔(秒)")
    p.add_argument("-o", "--out", default="scraped.csv")
    p.set_defaults(func=run)
