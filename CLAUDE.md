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

## ディレクトリ構成

- `CLAUDE.md` — このファイル。プロジェクトの目的とルール。
- `scripts/process_memo.py` — メモを受け取り、Claude API で分類・整形し、
  Markdownとして保存する。`--commit` を付けるとその場で `git add/commit/push` まで行う。
- `scripts/requirements.txt` — `process_memo.py` の依存パッケージ(`anthropic`)。
- `docs/daily-logs/` — 生成されたメモの蓄積先。
- `.github/workflows/process-memo.yml` — 自動化トリガー
  (`repository_dispatch` / `workflow_dispatch`)からスクリプトを起動する設定。

## 必要なSecrets

- `ANTHROPIC_API_KEY` — Claude API キー。GitHub リポジトリの
  Settings → Secrets and variables → Actions に登録しておく。
