# 議事録自動化パイプライン (Google Drive → Gemini → Jev)

スマホから「議事録データ」共有フォルダ(Googleドライブ)に置いたテキスト/Googleドキュメント/
スプレッドシートを検知し、Gemini APIで「要約・決定事項・期限付きToDo」に構造化、
TypeSafe(Jev)で構造・内容の安全検証をした上で `output/` にJSON+Markdownとして書き出す、
`node run.js` 一発実行のパイプライン。

このリポジトリの既存の `docs/daily-logs` パイプライン(`scripts/process_memo.py`,
Claude API + GitHub Actions)とは別系統。既存パイプラインには手を加えていない。

## 構成

| ファイル | 役割 |
| --- | --- |
| `fetch-data.js` | Googleドライブの指定フォルダから最新ファイルを検知・ダウンロード |
| `gemini-extract.js` | Gemini APIでテキストを summary/decisions/todos に構造化 |
| `validate.js` | ① 構造検証(型・必須項目、ネットワーク不要) ② Jev(TypeSafe)による意味的妥当性検証。どちらか失敗で処理を中断する安全ブレーキ |
| `run.js` | 上記を1コマンドでつなぐ司令塔。ログは `logs/run.log` に追記 |

## セットアップ

```bash
cd automation
npm install
cp .env.example .env   # 値を埋める。.envはコミットしない
node run.js
```

必要な環境変数は `.env.example` を参照。

## Jev連携についての重要な注意

`validate.js` のTypeSafe(Jev) API呼び出し(エンドポイント・リクエスト/レスポンス形式)は、
構築時に `docs.typesafe.ai` へのネットワークアクセスがブロックされていたため、
**公式ドキュメントで未確認・未検証のまま**書かれている(TypeSafe Claude Codeスキルの
説明文から推測したベストエフォート実装)。本番投入前に必ず以下で正式な契約を確認し、
`validateWithJev()` 内のfetch呼び出しを合わせて修正すること。

- https://docs.typesafe.ai/api.md
- https://docs.typesafe.ai/primitives/noul.md

`TYPESAFE_API_KEY` が未設定、またはJev呼び出しが失敗した場合の挙動は
`JEV_FAIL_OPEN`(既定 `false` = fail-closed、パイプラインを中断)で制御する。

**APIキーの取り扱い**: `.env`にのみ置き、絶対にコミットしない。チャットやチケット等の
平文でキーを共有してしまった場合は、動作確認前にTypeSafe側でキーをローテーション(再発行)
すること。

## Playwright / zx について

要求により `playwright` を依存関係に含めているが、現在のフロー(Googleドライブは公式
`googleapis` REST、Gemini呼び出しは公式SDK)はブラウザ自動操縦を必要としないため未使用。
将来ブラウザ経由でしか取得できないデータソースを追加する場合のために温存している。
`zx`(`$`, `fs`, `path`)は `run.js` のファイル操作・ログ出力に使用している。

## 未検証・今後の宿題

- Jev API契約の確認と `validate.js` の修正(上記)
- Googleドライブのサービスアカウント認証情報の発行・共有設定
- `output/` の書き込み先をスプレッドシート等に変更する場合は別途実装
- ポーリング実行のスケジューリング(cron / GitHub Actions等)は未実装。今は手動 `node run.js`
