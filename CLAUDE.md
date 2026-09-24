# メモ自動蓄積パイプライン

## 目的

現役魚屋（48歳）が日々スマホから吐き出す「愚痴・修羅場・AI自動化の試行錯誤」の生メモを、
Claude API で自動的に構造化し、このリポジトリの `docs/daily-logs/` に Markdown として
蓄積する。将来のショート動画・SNS投稿・ブログ記事のネタ帳として使う一次データベース。

## 全体フロー

1. スマホの Gemini / メモアプリ等に吐き出したテキストを、GitHub Actions の
   `repository_dispatch`（iOS ショートカット等からの自動POST）または
   `workflow_dispatch`（GitHub モバイルアプリからの手動実行）でこのリポジトリに送る。
2. `.github/workflows/process-memo.yml` が起動し、`scripts/process_memo.py` を実行する。
3. スクリプトは Claude API（Anthropic API, `claude-opus-5`）にメモを渡し、
   以下の3項目に自動分類・整形させる。
4. 整形結果を Markdown ファイルとして `docs/daily-logs/` にコミット・プッシュする。
5. (任意) 蓄積したログの中から動画化したいものを選び、`.github/workflows/generate-short-video.yml`
   を起動すると、`scripts/generate_short_video.py` がナレーション音声・字幕付きの縦型
   ショート動画(MP4)を生成し、GitHub Releaseに添付してダウンロードURLを発行する。

## データフォーマットのルール

各ログファイルは `docs/daily-logs/YYYY-MM-DD-HHMMSS-<slug>.md` という名前で保存する。
ファイルの中身は必ず以下の3セクション構成に従う。

```markdown
# <フック用タイトル(最有力案)>

- date: YYYY-MM-DD HH:MM
- tags: <カンマ区切りのタグ>

## ① ショート動画・フック用タイトル
<3案程度の候補タイトル(箇条書き)>

## ② 一次情報ドキュメント(事実と感情)
<何が起きたか(事実)と、そのとき何を感じたか(感情)を分けて記述した一次データ>

## ③ GitHub/ストック用Markdownデータ
<検索・再利用しやすい形に整理した要約(箇条書き、キーワード込み)>

---
### 元メモ(生データ)
<ユーザーが投げた元のテキストをそのまま保存>
```

- 元メモは絶対に加工せず、`### 元メモ(生データ)` セクションに原文のまま残す
  (後から人間やAIが読み返して事実確認できるようにするため)。
- タイトルや分類はあくまでClaudeによる一次整形であり、人間が後から
  Markdownファイルを直接編集して修正してよい。
- ファイル名の日時は取り込み時刻(UTC)を使う。

## 動画生成エンジンの選定方針

「既存のショート動画自動生成OSSアプリを丸ごと取り込む」のではなく、そうしたOSSアプリの
内部で実際に使われているのと同じ枯れたビルディングブロックを直接組み合わせる方式を採用した。

- **TTS(音声合成)**: [`edge-tts`](https://github.com/rany2/edge-tts)(MIT、APIキー不要、
  無料)。Microsoft Edgeの高品質ニューラル音声を日本語含め利用でき、単語ごとの発話タイミング
  (WordBoundary)も取得できるため、字幕の自動タイミング合わせに使える。
- **動画合成・字幕焼き込み**: `ffmpeg` + `libass`(GitHub Actionsの `ubuntu-latest` に
  標準搭載)。`.ass` 字幕ファイルを生成し、`ass` フィルタで縦型(9:16, 1080x1920)動画に
  焼き込む。日本語フォント(`fonts-noto-cjk`)のインストールが別途必要(ワークフローに含む)。
- 出所不明な大型OSSリポジトリを丸ごと依存に加えないことで、ライセンス・保守性・CI実行環境
  との相性リスクを避けつつ、車輪の再発明もしていない(TTSエンジンもレンダラも既存OSS)。

## ディレクトリ構成

- `CLAUDE.md` — このファイル。プロジェクトの目的とルール。
- `scripts/process_memo.py` — メモを受け取り、Claude API で分類・整形し、
  Markdownとして保存する。`--commit` を付けるとその場で `git add/commit/push` まで行う。
- `scripts/generate_short_video.py` — `docs/daily-logs/` のログ(または直接指定した
  ナレーション文)から、TTS音声・字幕焼き込み済みの縦型ショート動画(MP4)を `output/` に
  生成する。`output/` は `.gitignore` 対象(リポジトリを肥大化させないため)。
- `scripts/requirements.txt` — 依存パッケージ(`anthropic`, `edge-tts`)。
- `package.json` — X自動投稿のAI生成用(`@anthropic-ai/sdk`)。
- `docs/daily-logs/` — 生成されたメモの蓄積先。
- `freelance/` — クラウドワークス案件自動ハンター(`python3 freelance/fl.py scrape-cw`)。
  詳細は `freelance/README.md`。取得結果の `freelance/projects/` は、最新版(`cw_latest_projects.csv/.html`)以外 Git に入れない。
- `sengoku-shield/` — 戦国シールド(詐欺電話対策ツール)。Twilio着信にAIが応対して時間を稼ぎ、
  正規表現で詐欺パターンを検知する。声紋照合・公的機関の名乗り・SNS自動投稿は意図的に入れていない。
  詳細は `sengoku-shield/README.md`。
- `.github/workflows/process-memo.yml` — メモ取り込みの自動化トリガー
  (`repository_dispatch` / `workflow_dispatch`)。
- `.github/workflows/generate-short-video.yml` — 動画生成の自動化トリガー。
  生成したMP4はGitHub Releaseに添付され、スマホからダウンロードURLとして取得できる。

## SNS自動投稿(X)とマネタイズ導線

- `x_broadcast.js` + `x_episodes.json` — 毎日17:30 JSTに `.github/workflows/daily-x-post.yml`
  がテンプレートを日替わりローテーションでXに投稿する(LINEの `broadcast.js` と同じ方式)。
- リンク先はリポジトリ変数(Actions → Variables)で設定する: `GAME_URL`(バツルーレット)、
  `MIKUCHIWARI_URL`(三口割り)、`AFFILIATE_URL`(Amazonアソシエイト等)。
  未設定のURLを使うテンプレートは自動でスキップ。有料版(480円)の課金はバツルーレット本体
  (baturu-retto リポジトリの `billing.js`)にあるので、有料版の宣伝は `GAME_URL` に誘導する。
- `ANTHROPIC_API_KEY` があれば、その日のテンプレートの `topic` をもとに Claude(`claude-opus-5`)が
  本文だけを毎日書き直す。URL・ハッシュタグ・【PR】はプログラム側で付け、AIには書かせない。
  AIが失敗・拒否・ルール違反(URLやハッシュタグを含む等)・文字数オーバーのときは固定文面で投稿する。
- 広告・アフィリエイトを含むテンプレートは `"ad": true` にすると先頭に `【PR】` が自動で付く
  (ステマ規制=景品表示法への対応。外さないこと)。
- 文字数はXの数え方(日本語2・URL23)で280以内かを投稿前にチェックする。
- 手動実行時に `dry_run=1` を指定すると投稿せず文面だけ確認できる。

## 必要なSecrets

- `ANTHROPIC_API_KEY` — Claude API キー。GitHub リポジトリの
  Settings → Secrets and variables → Actions に登録しておく。
- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` — X自動投稿用
  (X Developer Portalで「Read and write」権限のアプリを作り、OAuth 1.0aのキーを発行する)。
- 動画生成ワークフローは追加のSecret不要(標準の `GITHUB_TOKEN` でReleaseを作成)。
  将来Googleドライブ等に連携する場合は、サービスアカウントJSON等を別途Secretsに追加する。
