# baturu-retto-line-bot

バツルーレット(罰ゲームルーレット)の宣伝エピソードを、毎日 LINE と Facebook に
自動配信するためのスクリプト集です。ゲーム本体(ルーレットUI)は別リポジトリで
GitHub Pages ホストされており、このリポジトリには含まれません。

## 構成

| ファイル | 役割 |
|---|---|
| `broadcast.js` | LINE の broadcast API にエピソードを配信 |
| `fb_broadcast.js` | Facebook ページに投稿 |
| `episodes.json` / `fb_episodes.json` | 配信する文言(日替わりで巡回) |
| `lib/imageGen.js` | (任意)エピソードに合わせた画像を生成するプロバイダー抽象化 |
| `.github/workflows/daily-broadcast.yml` | 毎日9時(UTC)に `broadcast.js` を実行するCron |

依存パッケージはありません。Node.js 標準の `fetch` のみで動作します。

## 実行

```sh
LINE_CHANNEL_ACCESS_TOKEN=xxx node broadcast.js
FB_PAGE_ID=xxx FB_PAGE_ACCESS_TOKEN=xxx node fb_broadcast.js
```

## テスト

```sh
npm test
```

## 画像生成連携(任意機能)

`IMAGE_PROVIDER` を設定すると、配信文言に加えてその日のエピソードに合わせた
画像を自動生成して添付します。未設定、またはAPI呼び出しが失敗した場合は
自動的にテキストのみの配信にフォールバックするため、既存の配信は壊れません。

| `IMAGE_PROVIDER` | 必要な環境変数 | 備考 |
|---|---|---|
| `fal` | `FAL_KEY`(必須), `FAL_MODEL`(任意、既定 `fal-ai/flux/schnell`) | [fal.ai](https://fal.run) 経由でFLUXモデルを呼び出し、公開URLを取得。LINE/Facebookともに画像URLが必須のため、実運用では基本このプロバイダーを推奨 |
| `stability` | `STABILITY_API_KEY` | Stability AI の Stable Image API。base64画像を返すため、現状は自動投稿ではなく生成結果の確認・保存用途向け |
| `automatic1111` | `A1111_API_URL` | セルフホストの AUTOMATIC1111 (Stable Diffusion WebUI) `/sdapi/v1/txt2img` を呼び出し。同上、base64画像を返す |

GitHub Actions で有効化する場合は、リポジトリの Secrets に上記変数を登録し、
`.github/workflows/daily-broadcast.yml` の `env` に渡すだけで動作します(既に
配線済みで、未設定なら空文字として無視されます)。

## スコープについて(検討記録)

当初「Replit / Bolt.new / v0 / Cursor / Lovable / Windsurf / Marblism /
GPT Engineer」などのAI開発プラットフォームを本リポジトリに統合する依頼が
ありましたが、これらは「アプリを作るための開発ツール・IDE」であり、稼働中の
配信スクリプトが実行時にAPIとして呼び出す対象ではないため、意味のある統合は
できません。それらは「ゲーム本体を作る/改修する」フェーズ(別リポジトリでの
フロントエンド開発)で人間が選んで使うツールとして検討するのが適切です。

画像生成系(FLUX / Stable Diffusion 系)のみ、実際にHTTP APIとして呼び出せる
ため `lib/imageGen.js` として実装しました。ComfyUI はワークフローグラフJSONを
都度組む必要がありノード構成に依存するため、汎用クライアントとしては未対応です
(具体的なワークフローが決まれば追加できます)。
