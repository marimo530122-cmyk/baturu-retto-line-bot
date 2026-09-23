# クラウドワークス案件自動ハンター

クラウドワークスの公開検索ページ(ログイン不要)を指定キーワードで検索し、
「AIで9割自動化できて安全な事務系案件」だけを点数付きで一覧にします。

## 使い方

```bash
python3 freelance/fl.py scrape-cw                     # config.json のキーワードで新着パトロール
python3 freelance/fl.py scrape-cw -k Excel -k 清書      # キーワードを指定
python3 freelance/fl.py scrape-cw --new-only          # 前回までに見た案件を一覧から外す
python3 freelance/fl.py scrape-cw --min-budget 5000   # 最低報酬を一時的に変える
python3 freelance/fl.py scrape-cw --from-html 保存したページ.html  # ネットに繋がず解析だけ
```

結果は `freelance/projects/` にできます(Git には入りません)。

- `cw_日時.csv` — 厳選した案件(スコア順)。Excel でそのまま開けます
- `cw_日時_excluded.csv` — 除外した案件と、その理由
- `cw_日時.xlsx` — 上の2つを1ファイルにしたもの(`pip install openpyxl` 済みのときだけ)
- `seen_ids.json` — 一度見た案件のID。次回以降、初めて見る案件に「★」が付きます

依存ライブラリは不要です(Python 3.9以上の標準機能だけで動きます。xlsx出力だけ openpyxl を使います)。

## 判定のしかた(`config.json` で調整)

| 項目 | 内容 |
|---|---|
| `search_keywords` | 検索するキーワード |
| `target_words` | 対象ワードと点数。タイトルに出ると2倍 |
| `ng_words` | マクロ/VBA/GAS必須、AI利用禁止、電話・出社ありなどを除外 |
| `scam_words` | 外部LINE誘導・初期費用・誇大な「稼げる」表現などの要注意案件を除外 |
| `min_fixed_budget_yen` / `min_hourly_wage_yen` | これ未満の報酬は除外(タスク形式の1件数十円案件もここで落ちます) |
| `min_score` | この点数未満は一覧に出さない |
| `request_interval_sec` | 検索リクエストの間隔(秒)。サイトに負荷をかけないため短くしないこと |

## 注意

- robots.txt で禁止されている場合や、サイトから拒否(403/429)された場合は自動で止まります。
  取得は1キーワード1ページ・数秒間隔にしているので、実行は1日数回程度にしてください。
- 案件を読み取れなかったときは、ページを `freelance/projects/debug/` に保存します。
  サイトの作りが変わった可能性があるので、そのHTMLを添えて修正を依頼してください。
- 「AI利用禁止」などは募集文の概要に書かれた範囲でしか判定できません。応募前に必ず本文を読んでください。
