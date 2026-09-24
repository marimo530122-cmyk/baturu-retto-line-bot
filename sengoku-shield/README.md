# 戦国シールド(詐欺電話対策ツール)

Twilio の電話番号にかかってきた電話に AI が「のんびりした一般人」として応対し、
**詐欺電話の相手の時間を稼ぐ**ツール。通話内容から**詐欺によくある言い回しを検知**して
ログに残し、疑いが強いときは持ち主の LINE に知らせる。

## できること

| 機能 | 中身 |
|---|---|
| 自動応答 | 冒頭で「自動応答システムが応対し、通話内容は記録されます」と**事実だけ**を告げてから会話する |
| AIおとり応答 | Claude(`claude-opus-5`)が1〜2文で返事。個人情報・番号は絶対に言わない。APIキーが無い/失敗/拒否のときは固定の時間稼ぎフレーズ |
| 詐欺パターン検知 | 正規表現で「還付金」「ATM」「暗証番号」「ギフトカード」「未納・訴訟」「口座凍結」「公的機関を名乗る」「今日中」「口止め」などを検知し、スコア化(高/中/低/なし) |
| Jevで2段目の判定(任意) | 通話が終わったら、TypeSafe の Jev に会話全体を渡して「詐欺らしさ」を判定。正規表現の結果と合わせて最終判定を出す(下記) |
| 家族の電話は素通し | `SHIELD_ALLOWLIST` の番号は AI を通さず `SHIELD_FORWARD_TO` に転送 |
| LINE通知(任意) | 疑い「高」の通話が終わったら持ち主に通知(番号は下4桁以外を伏せる) |
| SNS下書き | `node sns-draft.js <CallSid>` で注意喚起投稿の**下書きだけ**を作る。自動投稿はしない |
| 料金の上限 | 1通話あたり最大20往復・10分で自動終了(変更可) |

## Jev(TypeSafe)との組み合わせ方

正規表現は「決まった言い回し」しか拾えないため、Jev で会話の**流れ**を見て補う。

| 正規表現の判定 | Jevの判定 | 最終判定 | ねらい |
|---|---|---|---|
| 高 | 何でも | **高** | 典型的な手口は見逃さない |
| 何でも | 詐欺の可能性大 / 危険度3 | **高** | 言い換え(「お金が戻る手続き」等)を拾う |
| 中 | 普通の用件 / 危険度0 | **低** | 単語だけの誤検知(本物の宅配業者の「今日中に」等)を減らす |
| 低・なし | 怪しい / 危険度2 | **中** | 言い回しに出ない怪しさを拾う |
| (Jev未設定・失敗) | — | 正規表現のまま | Jevが止まってもシールドは止まらない |

- Jev は**通話が終わってから1回だけ**呼ぶ(通話中に呼ぶと応答が遅れて電話が切れるため)。
- Jev の判定も自動判定であり、相手を詐欺と断定する根拠にはしない。
- 会話の文字起こしが TypeSafe(外部サービス)に送られる点に注意。
- API の形式は `realtime-minutes/lib/classify/jevClassifier.ts` と同じ `POST /v1/systemone`。本番で使う前に、実際の Jev で1回試して応答形式を確認すること。

## あえてやらないこと(と理由)

- **声紋照合・オレオレ詐欺(家族なりすまし)検知** … 精度が低く、本物の家族を詐欺扱いするなど誤判定の実害が大きい。
- **警察・役所など公的機関っぽい声・名乗り** … なりすまし・脅迫になるリスク。AIにも実在の組織を名乗らせない。
- **SNS自動投稿** … 誤検知だった場合、無関係の人や会社の名誉毀損になりうる。下書き+チェックリストで人間が確認して手動投稿。
- **「録音して警察に通報しています」等のアナウンス** … やっていないことを言うと虚偽告知になりうる。実際にしていること(自動応答・記録)だけを告げる。
- **「世界初」「国家レベル」などの宣伝文句** … 実態と合わない。有償販売するなら景品表示法・特定商取引法上のリスクにもなる。

※ 検知結果は「よくある手口の言い回しが含まれていた」という目安であり、相手を詐欺師と断定するものではない。

## セットアップ

```bash
cd sengoku-shield
npm install
```

### 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `TWILIO_AUTH_TOKEN` | ○ | Twilio からのリクエストの署名検証に使う |
| `SHIELD_PUBLIC_URL` | ○ | このサーバーの公開URL(例: `https://shield.example.com`)。署名検証に使う |
| `ANTHROPIC_API_KEY` | | あれば AI が返事をする。無ければ固定フレーズ |
| `SHIELD_ALLOWLIST` | | AIを通さず転送する番号(カンマ区切り、`+8190...` 形式) |
| `SHIELD_FORWARD_TO` | | 転送先の電話番号 |
| `TYPESAFE_API_KEY` | | あれば通話終了後に Jev で2段目の判定をする |
| `TYPESAFE_API_BASE_URL` / `JEV_MODEL` | | 既定 `https://api.typesafe.ai` / `jev-1.13.0` |
| `LINE_CHANNEL_ACCESS_TOKEN` / `SHIELD_LINE_USER_ID` | | 両方あれば疑い「高」を LINE に通知 |
| `SHIELD_MAX_TURNS` / `SHIELD_MAX_CALL_SEC` | | 1通話の上限(既定 20往復 / 600秒) |
| `TWILIO_VOICE` | | 読み上げ音声(既定 `Polly.Mizuki`) |
| `PORT` | | 既定 3000 |

### Twilio の設定

電話番号の Voice Configuration で:

- **A call comes in** → Webhook `POST <SHIELD_PUBLIC_URL>/voice/incoming`
- **Call status changes** → `POST <SHIELD_PUBLIC_URL>/voice/status`

### 起動

```bash
npm start
```

## 使い方

```bash
npm run report              # 通話ログ一覧
node report.js <CallSid>    # 1件の会話全文と検知結果
node sns-draft.js <CallSid> # 注意喚起SNS投稿の下書き(data/drafts/ に保存。投稿は手動)
npm test                    # テスト(APIキー・Twilio不要)
```

通話ログは `data/calls/<CallSid>.json` に保存される(`data/` は Git に入れない)。

## 構成

- `server.js` — Twilio の webhook を受けるサーバー(`/voice/incoming`, `/voice/turn`, `/voice/status`, `/health`)
- `lib/detector.js` — 詐欺パターン検知(正規表現+重み付けスコア)
- `lib/decoy.js` — AIおとり応答(Claude API、失敗時は固定フレーズ)
- `lib/jev.js` — Jev(TypeSafe)による2段目の判定と、正規表現の判定との組み合わせ
- `lib/twilio.js` — 署名検証・TwiML生成
- `lib/store.js` — 通話ログの保存
- `lib/notify.js` — LINE 通知
- `lib/mask.js` — 電話番号・数字の伏せ字
- `report.js` / `sns-draft.js` — ログ閲覧・SNS下書き
