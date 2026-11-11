# 鮮刻シールドの見張りと、通知の記録(12/15 の家族モニター実証実験用)

ここに書いた設定は、すべてスマホからできる。合言葉や鍵は、チャット・メモ・Git に書かず、各サービスの画面にだけ入れる。

## 1. 止まったら知らせる(外からの見張り:cron-job.org、約5分)

サーバーが止まると、サーバーは自分で知らせられない。そこで外から5分ごとに `/health` を開き、
返事がない・エラーのときはメールで知らせてもらう。`/health` は、データの保存先に書き込めるかまで確かめる
(書き込めないと 503 を返す。家族の名簿や通知の記録が残らない状態のため)。

1. https://cron-job.org にログイン(X自動投稿のタイマーと同じアカウントでよい) → **CREATE CRONJOB**
2. **COMMON** タブ
   - Title: `鮮刻シールド 見張り`
   - URL: `https://sengoku-shield.onrender.com/health`(Render の画面に出ている自分のURL)
   - Execution schedule: **Every 5 minutes**
3. 知らせの設定(Notifications)
   - 「実行に失敗したとき(execution fails)」のメールをオンにする
   - 「失敗のあと、また成功したとき」もオンにすると、直ったことも分かる
4. **SAVE** → **TEST RUN** を押し、結果が **200** なら設定完了

- 合言葉は使わないので、鍵の設定はいらない
- Render は有料プラン(starter)なので、無料プランのように眠って止まることはない。止まるのは障害・エラーのとき
- `.github/workflows/sengoku-shield-health.yml` は、デプロイのあとに手で動かす点検として残す
  (GitHub の定期実行は何時間も遅れることがあるので、見張りには使わない)

## 2. 動いているときの異常を知らせる(中からの警報)

次のときは、管理者の LINE と Discord / Slack(`SHIELD_ALERT_WEBHOOK_URL`)に警報が届く。同じ種類の警報は10分に1回まで。

- 家族への知らせ(LINE・自動電話)が、1件も届かなかった/一部しか届かなかった
- 通知の記録を書き込めなかった
- `/health` でデータの保存先に書き込めなかった
- これまでの警報(合言葉の総当たり・連打・サーバーエラーの多発など)

管理者の LINE を設定する:

1. LINE Developers(https://developers.line.biz) → 鮮刻シールドの Messaging API チャネル → **チャネル基本設定**
2. 一番下の「**あなたのユーザーID**」(U で始まる長い文字)をコピー
3. Render の sengoku-shield → **Environment** → `SHIELD_ADMIN_LINE_ID` に貼って保存
4. 鮮刻シールドの公式アカウントを、自分の LINE で友だち追加しておく(追加していないと届かない)

- 見守られる本人や家族の ID は入れない(警報が本人のスマホに届かないように)
- LINE 自体が止まっているときは LINE の警報も届かないので、Discord / Slack もあると安心

## 3. 通知の記録(data/notify-log.jsonl)と CSV の取り出し

詐欺の疑いに気づいた時刻から、家族・持ち主への知らせが終わるまでの時間と成否を、1件1行で記録している。
**会話の中身・電話番号・LINE のID・口座番号は記録しない。** 見守りの回は、元に戻せない短い印(ハッシュ)で残す。

| 列 | 中身 |
|---|---|
| ts | 知らせが終わった時刻(UTC。日本時間は +9時間) |
| kind | 知らせの種類(下の表) |
| session | 見守りの回の印(同じ回の知らせをまとめて数える用) |
| detected_at | 詐欺の疑いに気づいた時刻(サーバーが判定した時刻、UTC) |
| latency_ms | 気づいてから知らせが終わるまで(ミリ秒。1000 で1秒) |
| targets / sent / failed | 送り先の数 / 届いた数 / 届かなかった数 |
| result | ok(全部届いた)/ partial(一部だけ)/ failed(1件も届かない) |
| errors | 届かなかった理由(LINE の応答番号・network・timeout など) |
| kind_label | 種類の説明(日本語) |

| kind | 意味 |
|---|---|
| family_high | 見守り中に疑い「高」になった(家族のLINE) |
| family_account | 相手が振込先の口座を言った(家族のLINE、急ぎ) |
| family_autocall | 家族への自動音声の電話(急ぎ) |
| family_handoff / family_ended | 本人がAIに代わった / 電話が終わった(家族のLINE) |
| family_call_summary / owner_call | 固定電話にAIが出た通話のまとめ(家族 / 持ち主のLINE) |

- 「届いた」は、LINE が受け付けたこと(相手が読んだかまでは分からない)。自動電話は、電話をかけられたこと
- 時刻はサーバーの時計。スマホの画面で検知した瞬間から、サーバーに届くまでの数秒は含まない

取り出し方(スマホのブラウザでできる):

1. Render の sengoku-shield → **Environment** で `SHIELD_ADMIN_TOKEN`(管理者用の合言葉)を確かめる
   - Blueprint から作り直していない場合は、自分で `SHIELD_ADMIN_TOKEN` を足し、長い合言葉を入れて保存する
2. `https://sengoku-shield.onrender.com/admin/notify-log` を開く
3. 合言葉を入れて **ダウンロード** → `notify-log-日付.csv` が保存される(Excel・Googleスプレッドシートで開ける)

- 合言葉が無い(設定していない)ときは、この画面ごと無いことになる(404)
- 合言葉を何度も間違えると、ほかの合言葉と同じく締め出されて警報が出る
