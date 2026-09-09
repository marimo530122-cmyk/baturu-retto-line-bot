# 一人飲みAI（LINEチャットボット）のデプロイ手順

## 1. 必要な鍵を3つ用意する

| 名前 | 取得場所 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console → 対象チャネル → Messaging API設定 → チャネルアクセストークン（長期）を発行 |
| `LINE_CHANNEL_SECRET` | LINE Developers Console → 対象チャネル → チャネル基本設定 → チャネルシークレット |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/ → API Keys → Create Key |

## 2. Vercelにデプロイする

1. https://vercel.com にログイン（GitHubアカウントでOK）
2. 「Add New... → Project」からこのリポジトリ（`baturu-retto-line-bot`）を選択
3. 特に設定は変えずに「Deploy」を押す
4. デプロイ完了後、プロジェクトの Settings → Environment Variables に、上記3つの鍵を登録
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `ANTHROPIC_API_KEY`
5. 環境変数を登録したら、Deployments タブから最新のデプロイを「Redeploy」する（環境変数は再デプロイしないと反映されません）

## 3. LINEにWebhookを設定する

1. デプロイ後に発行されたURL（例: `https://your-project.vercel.app`）の末尾に `/api/webhook` を付ける
   - 例: `https://your-project.vercel.app/api/webhook`
2. LINE Developers Console → 対象チャネル → Messaging API設定 → Webhook URL にこのURLを貼り付けて「更新」
3. 「Webhookの利用」をONにする
4. 「検証」ボタンを押して成功することを確認する
5. 同じ画面の「応答メッセージ」を **オフ**、「Webhook」を **オン** にする（LINE公式の自動応答と競合しないように）

## 4. 動作確認

LINE公式アカウントを友だち追加して、メッセージを送ってみてください。「一人飲みAI」が返信すれば成功です。
