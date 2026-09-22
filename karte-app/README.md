# 通院カルテ Webアプリ

病院の付き添い時、会話を音声で記録し、AIで「症状・診断・処方・次回の予約」に自動整理する
専用アプリ。モード切り替えは無く、開いたら常にこのカルテ画面。

`realtime-minutes`(このリポジトリの別アプリ、会議の議事録向け)から機能を引き継いで作った、
通院専用の別アプリ。同じコードベースを流用しているため、機能や使い方は
`realtime-minutes/README.md` の説明とほぼ同じ(モード切替がない点だけが違う)。

## 主な機能

- 大きな録音ボタン1つで音声入力(声が出しにくいときはキーボード入力も可)
- 処方箋・領収書などの写真/PDFの文字読み取り(Tesseract.js、無料・ブラウザ内完結)
- 症状/決定事項(診断)/処方・治療/次回の予約/気になること・質問/その他 の6分類
- 「次回の予約」「やること」からカレンダーへワンタップ追加(Googleカレンダー/.ics)
- 「カルテ」タブ: かんたん表示(大きな文字)とMarkdown表示、スマホの共有機能でLINE等に送信
- 過去の記録をブラウザ内(localStorage)に保存・一覧・閲覧
- PWA対応(ホーム画面に追加)、QRコード表示(PC画面→スマホでワンタップアクセス)

## セットアップ(最速でローカル起動)

```bash
cd karte-app
npm install
cp .env.local.example .env.local   # 何もしなければ mock 分類器でそのまま動く
npm run dev
```

`.env.local` の設定方法(Gemini/Claude/Ollama/TypeSafe Jevの切り替え)は
`realtime-minutes/README.md` を参照。

## デプロイ(別アプリとして公開する場合)

このフォルダを独立したVercelプロジェクトとしてデプロイすると、`realtime-minutes`とは
別のURLが発行される(例: `https://karte-app.vercel.app` のような形)。

1. [vercel.com](https://vercel.com) で「New Project」→ このGitHubリポジトリを選択
2. 「Root Directory」を `karte-app` に設定(これが重要。デフォルトのままだとリポジトリ
   ルートを見てしまい、正しくビルドできない)
3. Environment Variablesに、使うAIバックエンドのAPIキー(例: `CLASSIFIER_PROVIDER`,
   `GEMINI_API_KEY` 等)を登録
4. デプロイ完了後に発行されるURLが、このアプリ専用のアドレスになる

## ディレクトリ構成・技術詳細

`realtime-minutes/README.md` と同じ。内部的には汎用の`Mode`型("meeting"|"karte")を
引き続き使っているが、このアプリでは`"karte"`に固定していて、UI上モードを選ぶ場面は無い。
