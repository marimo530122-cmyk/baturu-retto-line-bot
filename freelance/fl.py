#!/usr/bin/env python3
"""フリーランス案件まわりのコマンド集。

使い方:
  python3 freelance/fl.py scrape-cw                 # config.json のキーワードで新着パトロール
  python3 freelance/fl.py scrape-cw -k Excel -k 清書  # キーワードを指定
  python3 freelance/fl.py scrape-cw --new-only      # 前回以降の新着だけ一覧に出す
  python3 freelance/fl.py scrape-cw --max-pages 2   # キーワードごとに2ページ目まで見る
  python3 freelance/fl.py scrape-cw --dump-html freelance/.debug  # 取得した生HTMLを保存
  python3 freelance/fl.py scrape-cw --commit        # 最新版の一覧を git commit / push まで行う
  python3 freelance/fl.py scrape-cw --from-html page.html  # 保存した検索ページを解析
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cw_hunter  # noqa: E402


def cmd_scrape_cw(args):
    try:
        cw_hunter.run(
            keywords=args.keyword,
            from_html=args.from_html,
            min_budget=args.min_budget,
            only_new=args.new_only,
            max_pages=args.max_pages,
            dump_html_dir=args.dump_html,
            commit=args.commit,
        )
    except cw_hunter.FetchBlocked as err:
        print(f"中止しました: {err}", file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="fl.py", description="フリーランス案件ツール")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("scrape-cw", help="クラウドワークスの新着案件を集めて厳選リストを作る")
    p.add_argument("-k", "--keyword", action="append",
                   help="検索キーワード(複数指定可)。省略時は config.json の search_keywords")
    p.add_argument("--min-budget", "--min-reward", dest="min_budget", type=int,
                   help="固定報酬の最低額(円)。省略時は config.json の min_fixed_budget_yen")
    p.add_argument("--new-only", action="store_true", help="前回までに見た案件を一覧から外す")
    p.add_argument("--max-pages", type=int,
                   help="キーワードごとに何ページ分取得するか。省略時は config.json の max_pages_per_keyword")
    p.add_argument("--dump-html", metavar="DIR", help="デバッグ用に、取得した生HTMLをこのフォルダに保存する")
    p.add_argument("--commit", action="store_true",
                   help="最新版の一覧(cw_latest_projects.csv/.html)を git commit / push まで行う")
    p.add_argument("--from-html", action="append", metavar="FILE",
                   help="ネットに繋がず、保存した検索結果ページのHTMLを解析する")
    p.set_defaults(func=cmd_scrape_cw)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
