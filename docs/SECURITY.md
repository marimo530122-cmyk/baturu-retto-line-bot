# セキュリティ点検と守りの仕組み

最終点検: 2026-10-25。対象は Render に置くサーバー(鮮刻シールド・医療AI)、
リアルタイム議事録(`realtime-minutes`)、GitHub Actions、Git の全履歴。

## 1. 認証(合言葉・ログイン)の点検結果

| 入口 | 守り方 | 結果 |
|---|---|---|
| 鮮刻シールド `/api/*` | `SHIELD_APP_TOKEN`(Bearer)を時間差の出ない比較で確認。未設定なら入口ごと閉じる | OK |
| 鮮刻シールド `/voice/*` | Twilio の署名(HMAC-SHA1)を確認。署名なしは 403 | OK |
| 鮮刻シールド `/line/webhook` | LINE の署名(HMAC-SHA256)を確認。署名なしは 401 | OK |
| 鮮刻シールド `/app` `/intel.js` `/health` | 画面とその部品だけ(中身のデータは `/api/*` 経由なので合言葉が要る) | OK |
| 医療AI 全API | ログインのトークン(DBには SHA-256 だけ保存)+役割チェック。30分で自動ログアウト | OK |
| 医療AI 音声 WebSocket | 最初のメッセージでトークンを確認(URLに入れない) | OK |
| 医療AI ログイン | scrypt でパスワード照合、5回間違いで15分ロック | OK |
| 議事録 `/api/classify` | ログイン無し(公開アプリ)。IP ごとの回数制限あり | 今回、文字数制限を追加 |
| 医療AI ローカル版(`medical-ai-local`) | 合言葉なし。同じ Wi‑Fi の中だけで使う前提 | 注意: 外のネットに公開しないこと |

DB は医療AIの SQLite だけで、SQL はすべて `?` のプレースホルダーで書かれている
(文字をつなげて SQL を作る箇所はゼロ)。画面に文字を出す所も `textContent` で、XSS の穴は見つからなかった。

## 2. 鍵(Secrets)のハードコード検診の結果

- `gitleaks` で **Git の全履歴(全ブランチ)を検査 → 漏れゼロ**。
- 鍵はすべて環境変数(`.env` / Render の Environment / GitHub の Secrets)から読む作り。
- コードに書いてある「それっぽい文字」はテスト用の偽物(`app-secret` など)と、
  医療AIの **公開デモ用パスワード**(`store.py` の `DEMO_USERS`、README でも公開)だけ。
  デモ用は `SEED_DEMO_USERS=true` のときしか作られない。**本物の患者情報を入れるサーバーでは必ず false**。
- `.gitignore` を強化し、`.env.*`・`*.pem`・`*.key`・サービスアカウントJSON・`.next/` を Git に入らないようにした。
- これからは GitHub Actions(`secret-scan.yml`)が push のたびに gitleaks を動かす。

### 万が一、鍵が漏れたときの手順(上から順に、すぐやる)

1. **まず鍵を無効にする**(Git から消すより先。履歴やコピーに残るので、消しただけでは守れない)
   | 鍵 | 無効にする場所 |
   |---|---|
   | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → 該当キーを Delete |
   | `OPENAI_API_KEY` | platform.openai.com → API keys → Revoke |
   | `GEMINI_API_KEY` | aistudio.google.com → API キー → 削除 |
   | `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys & tokens → Auth Token を「Request a secondary token」→「Promote」で入れ替え |
   | `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → チャネル基本設定で「再発行」/ Messaging API 設定でトークンを再発行 |
   | `X_API_KEY` ほか X のキー | developer.x.com → アプリ → Keys and tokens → Regenerate |
   | `TYPESAFE_API_KEY` | TypeSafe の管理画面でキーを削除・再発行 |
   | `SHIELD_APP_TOKEN` | Render → sengoku-shield → Environment → 値を新しく作り直して保存(見守り画面で入れ直す) |
   | `HACCP_ZIP_PASSWORD` | GitHub → Settings → Secrets で新しい値に変更(過去のZIPは古いパスワードのまま) |
   | Discord / Slack の Webhook | Discord: チャンネル設定 → 連携サービス → ウェブフック → 削除 / Slack: アプリ設定で Webhook を Revoke |
2. **新しい鍵を入れ直す**: Render の Environment と、GitHub の Settings → Secrets and variables → Actions。
3. **使われていないか確かめる**: 各サービスの利用量・請求の画面で、身に覚えのない使用がないか見る。
4. **(必要なら)履歴から消す**: 鍵を無効にした後で、`git filter-repo` で該当ファイルを履歴から消して強制 push。
   公開リポジトリは他人にコピーされている前提で、1 の無効化を必ず先にやる。

## 3. 入力値のチェック(今回追加したもの)

- 医療AI: 受け取る項目すべてに文字数の上限(名前など 200字・カルテ本文 20,000字・パスワード 256字・
  手入力の発言 5,000字・処方は50件まで・日数は1〜365)。超えたら 422 で断る。
- 議事録: 1回の発言 2,000字まで、前後の文脈は20件まで。内部のエラー文は画面に返さない。
- 鮮刻シールド: もともと全項目に型と長さの制限あり(`server.js` の `apiJudge` / `apiEvent` など)。

## 4. 連打・総当たりの見張りと警報

| | 鮮刻シールド (`lib/guard.js`) | 医療AI (`app/security.py`) |
|---|---|---|
| 1つのIPからの連打 | 1分120回を超えたら 429 | 同じ |
| 401/403 が続いたIP | 10回で15分締め出し(正しい合言葉でも通さない) | 20回で15分締め出し |
| 警報(5分あたり) | 401/403 が20回 / 5xx が5回 / 全体3000回 / 締め出し・連打の発生 | 401/403 が30回 / 5xx が5回 / 全体3000回 / 締め出し・連打の発生 |
| 警報の送り先 | `SHIELD_ALERT_WEBHOOK_URL` | `SECURITY_ALERT_WEBHOOK_URL` |
| 守りのヘッダー | nosniff / DENY / no-referrer / HSTS | 同じ+`Cache-Control: no-store` |

数字は環境変数で変えられる(`SHIELD_RATE_PER_MIN` / `SECURITY_RATE_PER_MIN` など)。同じ種類の警報は10分に1回まで。
メモリで数えるので再起動で数え直しになる(1台で動かす今の構成ならこれで足りる)。
IP は X-Forwarded-For の先頭を使うため、IP を偽って締め出しをすり抜けることはできる。その場合も「全体の 401/403 急増」の警報は鳴る。
合言葉そのものは Render が自動で作る長いランダム文字列なので、総当たりで当てるのは現実的に不可能(締め出しは二重の守り)。

## 5. 依存ライブラリの自動点検

- `.github/dependabot.yml`: 毎週月曜、穴のあるライブラリの更新PRを GitHub が自動で作る。
- `.github/workflows/security-scan.yml`: push・PR・毎週月曜に
  `npm audit`(5か所)・`pip-audit`(6ファイル)を実行。失敗したら Discord/Slack に通知。
- `.github/workflows/secret-scan.yml`: すべての push・PR で `gitleaks`(鍵の書き込みチェック)。

### 今わかっている残りの穴(別の作業で直す)

- `medical-ai/frontend` の Next.js 14.2.35 に **critical** の既知の穴。直すには Next.js 16 への更新が必要
  (大きな更新で画面が壊れる可能性があるため、今回は手を付けていない)。それまで点検ワークフローはここが赤になる。
- `realtime-minutes` は Next.js を 15.5.28 に更新して critical を解消。Next.js が中に持っている
  `postcss` の high が1件残る(ビルド時だけ使う部品。こちらも Next.js 16 で解消)。
