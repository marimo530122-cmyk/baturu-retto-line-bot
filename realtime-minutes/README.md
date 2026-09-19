# リアルタイム議事録 Webツール(プロトタイプ)

会議中の発言を音声認識でリアルタイムに文字起こしし、AIで7カテゴリに即座に分類、
右ペインに `markmap` で動的マインドマップを生成する Next.js プロトタイプ。

## 採用OSS技術

- **音声認識**: ブラウザ標準 [Web Speech API](https://developer.mozilla.org/ja/docs/Web/API/Web_Speech_API)。
  `lib/speech/types.ts` の `SpeechRecognizer` インターフェースで抽象化してあるので、
  将来 [whisper.cpp (WASM版)](https://github.com/ggerganov/whisper.cpp) 等に差し替える場合も
  実装クラスを1つ追加するだけで済む。
- **AI分類**: `CLASSIFIER_PROVIDER` 環境変数でバックエンドを切り替え可能。
  - `mock`(デフォルト): APIキー不要のルールベース分類器。セットアップ直後の動作確認用。
  - `gemini`: Google Gemini API(`gemini-2.5-flash`)
  - `claude`: Anthropic Claude API
  - `ollama`: ローカルLLM([Ollama](https://ollama.com)、`ollama serve` 済み前提)
- **マインドマップ**: [markmap-lib](https://github.com/markmap/markmap) / [markmap-view](https://github.com/markmap/markmap) で
  分類済み発言からMarkdownアウトラインを生成し、そのままツリー可視化。

## 7分類

決定事項 / 宿題 / 質問 / 懸念 / 要望 / 重要事項 / 雑談
(`lib/types.ts` の `CATEGORIES` で定義。バッジ色もここで管理)

## セットアップ(最速でローカル起動)

```bash
cd realtime-minutes
npm install
cp .env.local.example .env.local   # 何もしなければ mock 分類器でそのまま動く
npm run dev
```

ブラウザで `http://localhost:3000` を開き、「録音開始」を押してマイクを許可すれば動作確認できる。
**Web Speech API は Chrome系ブラウザでの利用を推奨**(Firefox/Safariは対応が限定的)。

### 実際のAIバックエンドに接続する場合

`.env.local` を編集:

```bash
# Gemini を使う例
CLASSIFIER_PROVIDER=gemini
GEMINI_API_KEY=xxxxx
GEMINI_MODEL=gemini-2.5-flash

# Claude を使う例
CLASSIFIER_PROVIDER=claude
ANTHROPIC_API_KEY=xxxxx
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# ローカルOllamaを使う例(事前に `ollama pull llama3.1` 等)
CLASSIFIER_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1
```

## 画面構成

- **左: タイムライン** — 発言がリアルタイムに流れ、カテゴリ別バッジが即座に付与される
- **右: インサイトビュー**(タブ切り替え)
  - マインドマップ: `markmap` によるツリー可視化(発言が増えるたびに自動更新)
  - ToDo/宿題: チェックボックス付きアクションアイテム一覧
  - 決定事項: 結論だけを時系列でピン留め
  - サマリー: Markdown形式の完成版議事録(コピー可能)
- スマホ縦画面ではヘッダー下のタブで「タイムライン」⇔「インサイト」を切り替え

## ディレクトリ構成

```
app/
  page.tsx              画面全体のレイアウト・状態接続
  api/classify/route.ts AI分類APIエンドポイント
components/              Timeline / InsightPanel / MindMapView / TodoList / DecisionLog / SummaryView
hooks/useMeetingSession.ts  録音〜分類〜状態更新のメインロジック
lib/speech/               STT抽象化レイヤー(Web Speech API実装)
lib/classify/              AI分類バックエンド抽象化(mock/gemini/claude/ollama)
lib/markmapTransform.ts    分類済み発言 → マインドマップ用Markdown
lib/summaryTransform.ts    分類済み発言 → 議事録Markdown
```

## 既知の制約(プロトタイプ段階)

- ToDoのチェック状態・発言履歴はページリロードで消える(永続化なし)。
- 話者分離(誰が発言したか)には未対応。
- Web Speech API はネットワーク経由でGoogleの音声認識サーバーを使う実装がほとんどで、
  完全ローカル・オフラインではない(完全ローカルにしたい場合はwhisper.cpp WASM版への
  差し替えを想定した抽象化を用意済み)。
