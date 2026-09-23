# クラウドワークス案件自動ハンター

クラウドワークスの公開案件検索ページから、指定キーワードに合う新着案件を集めて
`freelance/projects/` に一覧ファイル(CSV・HTML)として保存するツール。

## 使い方

```bash
cd freelance
pip install -r requirements.txt
cd ..

python3 freelance/fl.py scrape-cw
```

これだけで:
- 既定のキーワード(スプレッドシート / Excel / データ入力 / 資料作成)で検索
- 報酬3,000円未満、GAS/マクロ/VBA必須などの案件を自動で除外
- `freelance/projects/cw_latest_projects.csv`(GitHubの画面でそのまま表にして見られる)
- `freelance/projects/cw_latest_projects.html`(スマホのブラウザでそのまま開ける一覧)

を作る。実行のたびに前回の内容を上書きする(「最新版」を保つ運用)。

### よく使うオプション

```bash
# キーワードを指定したいとき(複数指定可、指定すると既定のキーワードは使わない)
python3 freelance/fl.py scrape-cw --keyword スプレッドシート --keyword Excel

# 報酬の下限を変える(円)
python3 freelance/fl.py scrape-cw --min-reward 5000

# キーワードごとに2ページ目まで見る
python3 freelance/fl.py scrape-cw --max-pages 2

# 生成後にそのままgit commit + pushまで行う(GitHub Actions等の自動実行用)
python3 freelance/fl.py scrape-cw --commit
```

除外キーワードや既定のキーワード・最低報酬は `freelance/fl.py` 冒頭の
`DEFAULT_KEYWORDS` / `EXCLUDE_KEYWORDS` / `DEFAULT_MIN_REWARD` で調整できる。

## 動作確認について(重要な注記)

このツールはクラウド版Claude Codeのサンドボックス環境で開発された。開発コンテナの組織egress
ポリシーが `crowdworks.jp` への接続を許可していないため(403 Forbidden)、実際のクラウドワークス
のページに対しては一度も検証できていない。

検証済み(ネットワーク不要な部分をユニットテストで確認):
- 報酬表記(「3,000円〜10,000円」「時給1,200円〜」等)からの金額抽出
- 除外キーワード判定
- 合成HTML(下記SELECTORSと同じ構造)からの案件抽出・重複排除
- CSV/HTML出力
- CLIの引数パース
- ネットワーク不通時に例外で落ちず、分かりやすいメッセージで中断すること

未検証(実機・実ネットワークでの確認が必須):
- `SEARCH_URL`(検索ページのURL・クエリパラメータ名)が実際に正しいか
- `SELECTORS`(案件カード・タイトル・報酬・カテゴリのCSSセレクタ)が実際のDOM構造と合っているか
- 検索結果がサーバー側で描画されたHTMLとして返るか(もしJavaScriptで後から描画される
  形式(SPA)だった場合、素の`requests`では中身が空で取れてしまう。その場合はHTML取得部分を
  Playwright等のヘッドレスブラウザに差し替える必要がある)

### 初回実行時にやること

1. `python3 freelance/fl.py scrape-cw --dump-html freelance/.debug` を実行する
   (`.debug/`配下に生HTMLが保存される。gitignore対象なのでコミットされない)
2. `0件」という警告が出た場合、`freelance/.debug/*.html` を開いて実際の案件一覧の
   HTML構造を確認する
3. `freelance/fl.py` 冒頭の `SEARCH_URL` と `SELECTORS` を、確認した実際の構造に合わせて修正する

## 注意

- robots.txtを起動時に確認し、許可されていない場合は自動で中断する(安全側のデフォルト)。
- サーバーへの負荷を抑えるため、リクエストの間隔を意図的に空けている(`REQUEST_INTERVAL_SEC`)。
- User-Agentに「個人が手動で動かすツールである」ことを正直に記載している(ブラウザを装って
  検知を回避するような実装はしていない)。
- クラウドワークスの利用規約は変更されることがあるため、自動アクセスが許可される条件を
  各自で確認してから使うこと。
