# X自動投稿のタイマー(cron-job.org)の設定手順

## なぜ外のタイマーを使うのか

GitHub の定期実行(schedule)は、毎日 4〜10時間遅れて動いていた(17:30 狙いの投稿が夜中1時ごろになった)。
そこで、時間どおりに動く無料のタイマー **cron-job.org** から、毎日 17:30 に「Daily X Post」を起動する。

- GitHub の定期実行は**予備**として残してある。cron-job.org が止まった日も、遅れてでも1日1本は出る
- 同じ日に2回起動しても、2回目は「今日の分は投稿済み」の印を見て投稿しない(二重投稿にならない)

## 1. GitHub のトークン(鍵)を作る

GitHub の画面で、**このリポジトリの Actions を起動することしかできない鍵**を作る。

1. GitHub 右上のアイコン → **Settings** → 左の一番下 **Developer settings**
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
3. 次のとおりに入れる
   - Token name: `x-post-timer`
   - Expiration: 最長(期限が来たら作り直す。期限切れの日は予備の定期実行で遅れて投稿される)
   - Repository access: **Only select repositories** → `marimo530122-cmyk/baturu-retto-line-bot` だけ
   - Permissions → Repository permissions → **Actions: Read and write**(ほかは触らない)
4. **Generate token** を押し、表示された鍵(`github_pat_` で始まる)をコピーする。
   **チャット・メモ・Git には貼らない。** 次の手順の cron-job.org の欄にだけ貼る

## 2. cron-job.org でタイマーを作る

1. https://cron-job.org で無料登録してログイン → **CREATE CRONJOB**
2. **COMMON** タブ
   - Title: `Daily X Post`
   - URL: `https://api.github.com/repos/marimo530122-cmyk/baturu-retto-line-bot/actions/workflows/daily-x-post.yml/dispatches`
   - Execution schedule: **Every day at 17:30**
   - タイムゾーンが **Asia/Tokyo** になっていることを確かめる(違えば Settings で Asia/Tokyo にする)
3. **ADVANCED** タブ
   - Request method: **POST**
   - Headers に次の4つを足す
     | Key | Value |
     |---|---|
     | `Authorization` | `Bearer ` + 1でコピーした鍵(Bearer と鍵の間に半角スペース1つ) |
     | `Accept` | `application/vnd.github+json` |
     | `X-GitHub-Api-Version` | `2022-11-28` |
     | `Content-Type` | `application/json` |
   - Request body:
     ```json
     {"ref":"main","inputs":{"dry_run":"0"}}
     ```
   - 失敗したらメールで知らせる設定(Notifications)をオンにしておく
4. **SAVE**

## 3. 動くか確かめる

- cron-job.org の画面で **TEST RUN** を押すと、その場で1回起動する。
  結果が **204 No Content** なら成功。GitHub の Actions に「Daily X Post」が1つ増える
  - 401 / 403 → 鍵の貼り間違い・権限不足・期限切れ。手順1をやり直す
  - 404 → URL の打ち間違い、または鍵の対象リポジトリが違う
  - 422 → Request body の打ち間違い
- **TEST RUN は本番の投稿になる。** その日の分がまだなら、その場で今日の話が投稿される
  (投稿済みなら「今日の分は投稿済み」で終わる)。投稿させずに試したいときは、
  Request body の `"0"` を一時的に `"1"` にして TEST RUN し、終わったら `"0"` に戻す
- 翌日以降は、Actions の「Daily X Post」の記録に
  `起動のきっかけ: workflow_dispatch / 起動時刻(日本時間): YYYY-MM-DD 17:3x` と出ていれば時間どおり

## 鍵の扱い

- 鍵は cron-job.org にだけ保存する。できることは「このリポジトリの Actions の起動・取り消し・記録の閲覧」だけで、
  コードの書き換えや X・Claude の鍵の読み出しはできない
- 漏れた疑いがあるときは、GitHub の Fine-grained tokens の画面でその鍵を **Revoke**(無効化)して作り直す
