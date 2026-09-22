# リアルタイム議事録 / 通院カルテ Webツール(プロトタイプ)

会話を音声認識でリアルタイムに文字起こしし、AIで自動分類。「議事録モード」と
「通院カルテモード」をワンタップで切り替えられる Next.js アプリ。

## 採用OSS技術

- **音声認識**: ブラウザ標準 [Web Speech API](https://developer.mozilla.org/ja/docs/Web/API/Web_Speech_API)。
  `lib/speech/types.ts` の `SpeechRecognizer` インターフェースで抽象化してあるので、
  将来 [whisper.cpp (WASM版)](https://github.com/ggerganov/whisper.cpp) 等に差し替える場合も
  実装クラスを1つ追加するだけで済む。声が出しにくいときのため、キーボード入力欄も用意している。
- **写真/PDFの文字読み取り(OCR)**: [Tesseract.js](https://github.com/naptha/tesseract.js)(ブラウザ内で
  完結、無料、追加の利用料金なし)。PDFは [pdfjs-dist](https://github.com/mozilla/pdf.js) で1ページ目を
  画像化してからOCRにかける(`lib/ocr.ts`)。読み取り結果はテキスト入力欄に流し込まれるだけで、
  自動送信はしない(OCRの誤読みをそのまま記録に残さないため、必ず人が見直してから送信する設計)。
  初回利用時、日本語の学習データ(数MB)をCDNから読み込む(通信は使うが料金は発生しない)。
- **AI分類**: `CLASSIFIER_PROVIDER` 環境変数でバックエンドを切り替え可能。
  - `mock`(デフォルト): APIキー不要のルールベース分類器。セットアップ直後の動作確認用。
  - `gemini`: Google Gemini API(`gemini-2.5-flash`)
  - `claude`: Anthropic Claude API
  - `ollama`: ローカルLLM([Ollama](https://ollama.com)、`ollama serve` 済み前提)
  - `jev`: [TypeSafe](https://typesafe.ai)のSystem OneモデルJev。分類をChoiceプリミティブ、
    重要度をScoreプリミティブに対応させている(`lib/classify/jevClassifier.ts`)。
    **エンドポイント/レスポンス形式は未検証**(構築時に`docs.typesafe.ai`へのネットワーク
    アクセスがブロックされていたため)。本番投入前に公式ドキュメントで契約を確認すること。
- **マインドマップ**: [markmap-lib](https://github.com/markmap/markmap) / [markmap-view](https://github.com/markmap/markmap) で
  分類済み発言からMarkdownアウトラインを生成し、そのままツリー可視化。
- **カレンダー連携**: 次回の予約・ToDoの各項目から、Googleカレンダーへのリンク、または
  `.ics`ファイル(iPhone標準カレンダー等)を生成する(`lib/calendar.ts`)。日付はAIが推測せず、
  必ずその場でユーザーが選ぶ(デフォルトは今日)。

## モードと分類

| | 議事録モード | 通院カルテモード |
| --- | --- | --- |
| 分類 | 決定事項/宿題/質問/懸念/要望/重要事項/雑談(7分類) | 症状/決定事項/処方・治療/次回の予約/気になること・質問/その他(6分類) |
| 用途 | 会議の発言をリアルタイム分類 | 通院時の会話を症状・診断・処方・次回予約に整理 |
| サマリー出力 | 議事録 | カルテ&処方箋(1枚の記録) |

(`lib/types.ts` の `CATEGORIES_BY_MODE` で定義。バッジ色もここで管理)

## セットアップ(最速でローカル起動)

```bash
cd realtime-minutes
npm install
cp .env.local.example .env.local   # 何もしなければ mock 分類器でそのまま動く
npm run dev
```

ブラウザで `http://localhost:3000` を開き、中央の大きな丸いボタンを押してマイクを許可すれば
動作確認できる。**Web Speech API は Chrome系ブラウザでの利用を推奨**(Firefox/Safariは対応が限定的)。

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

# TypeSafe(Jev)を使う例(エンドポイント契約は未検証、上記の注意参照)
CLASSIFIER_PROVIDER=jev
TYPESAFE_API_KEY=xxxxx
```

## 画面構成

- **ファーストビュー**: モード切替(議事録/通院カルテ)、大きな録音ボタン、キーボード入力、
  写真/PDF読み取りボタンをひとつの画面にまとめている(非エンジニアでも迷わない配置)
- **左: タイムライン** — 発言がリアルタイムに流れ、カテゴリ別バッジが即座に付与される
- **右: インサイトビュー**(タブ切り替え、モードにより内容が変わる)
  - マインドマップ: `markmap` によるツリー可視化(発言が増えるたびに自動更新)
  - ToDo/宿題・次回の予約: チェックボックス/カレンダー追加ボタン付きの一覧
  - 決定事項: 結論・診断だけを時系列でピン留め
  - サマリー/カルテ: 「かんたん表示」(大きな文字のカード)と「Markdown」を切り替え可能。
    スマホの共有機能(`navigator.share`)でLINE等にそのまま送れる
- **過去の記録**: ヘッダーの時計アイコンから、ブラウザのlocalStorageに保存した過去のセッションを
  一覧・閲覧できる(リセット時に保存するか確認される)
- スマホ縦画面ではヘッダー下のタブで「タイムライン」⇔「インサイト」を切り替え

## ディレクトリ構成

```
app/
  page.tsx              画面全体のレイアウト・状態接続
  api/classify/route.ts AI分類APIエンドポイント
components/              Timeline / InsightPanel / MindMapView / TodoList / DecisionLog /
                          AppointmentList / SummaryView / HistoryView / AddToCalendarButton /
                          DocumentScanInput
hooks/useMeetingSession.ts  録音/テキスト入力〜分類〜状態更新のメインロジック
lib/speech/               STT抽象化レイヤー(Web Speech API実装)
lib/classify/              AI分類バックエンド抽象化(mock/gemini/claude/ollama/jev)
lib/ocr.ts                写真/PDFの文字読み取り(Tesseract.js + pdfjs-dist)
lib/calendar.ts            カレンダー連携(Googleカレンダーリンク/.ics生成)
lib/history.ts             過去セッションのlocalStorage保存/読み込み
lib/markdownSections.ts    サマリーMarkdown → かんたん表示用のセクション分解
lib/markmapTransform.ts    分類済み発言 → マインドマップ用Markdown
lib/summaryTransform.ts    分類済み発言 → 議事録/カルテMarkdown
```

## 既知の制約(プロトタイプ段階)

- 過去の記録はこのブラウザのlocalStorageにのみ保存される(端末・ブラウザをまたいで共有されない、
  容量にも上限がある簡易的な仕組み)。
- 話者分離(誰が発言したか)には未対応。
- Web Speech API はネットワーク経由でGoogleの音声認識サーバーを使う実装がほとんどで、
  完全ローカル・オフラインではない(完全ローカルにしたい場合はwhisper.cpp WASM版への
  差し替えを想定した抽象化を用意済み)。
- OCR(`lib/ocr.ts`)はPDFの1ページ目のみ対応。複数ページの書類は今のところ非対応。
  読み取り精度はスキャンした紙の書類より、手書き・写真の傾き・照明に左右されやすい。
