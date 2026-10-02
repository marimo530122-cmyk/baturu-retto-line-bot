# 鮮刻シールド 引き継ぎ書(2026-10-03 更新)

新しい会話(別の窓)で鮮刻シールドの作業を続けるためのまとめ。最初にこのファイルと、リポジトリ直下の `CLAUDE.md`、
`sengoku-shield/README.md` を読むこと。守る決まり(やらないこと)は `CLAUDE.md` の `sengoku-shield/` の項に全部書いてある。

## 1. どんなものか・目的

- **鮮刻シールド**(せんこくシールド。「戦国」ではない)は、詐欺の撲滅を願って作っている詐欺電話対策ツール。
  作っている人(静岡県藤枝市の魚屋、48歳)の母が十数年前に詐欺で約100万円を取られている。
- いちばん大事なのは「詐欺の電話を取ってしまったあとの対処」:
  1. 見守り画面(`/app`)がスピーカーの声を聞いて詐欺らしさに気づき、やさしい言い訳と「AIに代わる」ボタンを出す
  2. 本人がボタンを押すと、AIが「だまされたふり」で振込先の口座・会う日時と場所・名乗った名前と所属を聞き出す(約束はしない)
  3. 口座が出たらその場で家族のLINEへ。家族から銀行・警察に伝えて口座を止めてもらう
  4. 電話のあと、110番でそのまま読める台本を出す(家族向けの台本もある)
- 判定は正規表現(`lib/detector.js`)+ Jev(TypeSafe、任意)。Twilio(固定電話の転送)は任意で、まだ契約していない。

## 2. 今の状態

- コードは `sengoku-shield/`。テスト 95件 すべて合格(`cd sengoku-shield && npm test`)。
- これまでの作業はすべて main に入っている(#17、#18)。#18 で警視庁・千葉県警・福島県警の実際の録音 66本を例文に追加し、
  検知ルールを15個追加、文字起こしワークフローを10並列にした。
- **まだ一度もサーバーに置いていない**。利用者は次に Render に置く予定(手順は 4 の1番)。
- ベンチマーク(`node benchmark.js`):

  | 項目 | 結果 |
  |---|---|
  | 普通の電話の誤検知 | 0 / 93 |
  | dev(ルールを直すときに見てよい例文) | 69 / 76 |
  | **holdout(見ないで実力を測る例文)** | **23 / 53(43%)** |
  | うち確認済みの本物(公式の文言・各県警の録音・藤枝の録音) | 20 / 43 |

  警視庁・千葉県警の実録音 63本で測ると、ルールを直す前は holdout 10/31(32%)、dev だけを見て直した後は 16/31(52%)。
  記録は `docs/police-videos/2026-10-02-keishicho-hannin-onsei.md`(反映のまとめもここ)と `…-chiba-kenkei-sagi-onsei.md`。

## 3. データの集め方の決まり(いちばん大事)

- **本物と確かめたものだけを例文にする**。Gemini がまとめた「犯人の実際のセリフ」は、URL が付いていても本文と違ったことがある
  (警察庁のページで確認済み)。Gemini の文は「未確認」として記録し、弱点さがしの参考にだけ使う。
- 確認できたら、**判定にかける前に** dev と holdout に分ける(だいたい半分ずつ。すでに判定にかけたことがある文は dev)。
  holdout を測ってから、**dev だけを見て**ルールを直す。holdout の見逃しには合わせない(数字が実力以上に良く見えるため)。
- 例文は犯人の言葉だけを短く引用。書き起こしの丸ごと貼り付け・個人名は入れない(このリポジトリは公開)。
- 記録は `docs/police-videos/` に1件1ファイル(決まりは同じフォルダの README.md)。地元の情報は `docs/fujieda_scam_context.md`。
- 確認できた出どころ:
  - 日本郵便 https://www.post.japanpost.jp/notification/notice/fraud-call.html (本文を利用者が貼り付け)
  - 警察庁 SOS47 https://www.npa.go.jp/bureau/safetylife/sos47/new-topics/241218/02.html (同上)
  - 静岡県警「サギ電話を聞いてみよう!」 https://www.pref.shizuoka.jp/police/kurashi/bohan/sagi/namaonsei.html (音声11本を文字起こし)
  - 藤枝防犯チャンネル(藤枝・焼津・島田・牧之原の4署合同、YouTube)の文字起こしのスクリーンショット
- この作業環境(Claude Code のクラウド)からは YouTube・警察庁・日本郵便・静岡県のサイトに直接つながらない。
  - ページの本文 → 利用者に貼り付けかスクリーンショットを頼む
  - 公開されている音声 → `.github/workflows/transcribe-police-audio.yml`(GitHub Actions がページから音声を取り、faster-whisper で文字起こし。
    結果は実行ログに出るだけで、音声も全文もリポジトリに保存しない)。一覧ページに音声が無ければ個別ページを1段たどり、
    最大10の作業に分けて同時に文字起こしする(警視庁62本が25分)。workflow_dispatch は main 以外のブランチも ref に指定できる。
    ログは大きいので MCP の get_job_logs で取ると手元のファイルに保存される。それを読んで犯人の言葉だけを選ぶ。
  - YouTube は GitHub Actions からも「ロボット確認」ではじかれる(ログイン情報は渡さない)。YouTube はスクリーンショットで。
  - 確認済みの音声ページ: 警視庁 https://action.digipolice.keishicho.metro.tokyo.lg.jp/list/sound (62本)、
    千葉県警 https://www.police.pref.chiba.jp/seisoka/safe-life_fraud-audio.html (52本)。福島県警は YouTube(スクリーンショットで3文)。

## 4. やり残し(優先順)

1. **Render に置いて、実際に動かす**(いちばん大事。本物の Claude・Jev・LINE ではまだ一度も試していない)。
   - 手順: dashboard.render.com →「New」→「Blueprint」→ リポジトリ baturu-retto-line-bot、ブランチ main →
     鍵の欄に持っている鍵だけ貼る(`ANTHROPIC_API_KEY`、あれば `TYPESAFE_API_KEY`)→「Apply」。
     Starter プラン(ディスク付き、月7ドル前後)。詳しくは `docs/cloud-setup.html`(Artifact: https://claude.ai/artifact/CakWGLbuxPjbqWXLTYTWZg)。
   - 置けたら利用者から URL だけを受け取る(鍵と合言葉は受け取らない)。確かめること: `URL/health` が ok、
     `URL/app` に合言葉(Render の Environment の `SHIELD_APP_TOKEN`)を入れて見守り画面が動く、Jev の応答の形(`npm run check`)。
   - そのあと家族か友達に犯人役をしてもらい、スピーカーにした電話で見守り画面とだまされたふりAIを試す
     (疑われて怒鳴られる場面も)。会話の記録をもとに聞き出し方を直す。
2. **公式LINEを作る**: 名前は「鮮刻」(senkoku)なので、ID はチラシの `@sengoku_shield` ではなく `@senkoku_shield` などにそろえる。
   鍵は Render の `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`、友だち追加URLは `SHIELD_LINE_ADD_URL` と
   `public/index.html` の `LINE_ADD_URL`。Webhook URL は `URL/line/webhook`。
3. **本物のデータを増やす**: 確認済みの本物は 87件(holdout 43件)。目標は holdout 50件。利用者に頼んであること:
   - YouTube の「文字起こしを表示」の文字をパソコンでコピーして貼る(福島県警の不正契約→LINE・ビデオ通話の動画、
     福島県警「ニセ警察官に扮した詐欺犯人の音声」、藤枝防犯チャンネルの「実際の刑事」「70代男性」)
   - ほかの県警(埼玉・大阪・愛知など)の「詐欺電話の音声」ページの URL → 届いたら同じワークフローで回す
   - 警察庁 SOS47 の本文: ビデオ通話のページ(new-topics/241218/06.html)と国際電話番号のページ(case/international-phone/)
4. holdout で見逃しているもの(dev に同じ種類の本物が入ったら、それを見て直す。中身は `node benchmark.js` の出力で):
   - NTTファイナンスの自動音声(「1を押して」と「NTTファイナンス」が別の発言。今のルールは1つの発言の中しか見ない)
   - 融資保証金(借金の一本化・審査料)、給付金を口実に家に来る話、「日本郵政グループ…保管期間」、「口座を調査する」
   - dev でもまだ拾えないもの: 待ち合わせの道案内だけの電話、「封筒は別々?」のような受け取りの確認、「捜査2課の者ですが」の一言だけ。
     「生活安全課」「捜査2課」の名乗りだけで拾うと、本物の警察の電話(b018・b085)まで疑いになるので入れていない。
5. 固定電話の転送(Twilio)を使うときに、「+1」「+44」など海外からの番号を手がかりにする(未実装。見守り画面では番号が分からない)。
6. チラシ(`docs/flyer-draft.md`)とLP(`public/index.html`、まだサーバーから配信していない)を配る前に:
   未実装のもの(申し込み・家ごとの050番号・月額980円の課金・24時間サポート)を載せない、
   ボイスワープの料金を書く、特定商取引法の表示・利用規約・プライバシーポリシー、電気通信事業の届出が要るか総務省に確認。
   一覧は `docs/setup-steps.md`。まずは家族・知人の数軒に無料で使ってもらうのがおすすめ。
7. 警察署でのヒアリング(`docs/hearing.html`、22問)。聞いた言い回しは、確認済みデータとして上の決まりで入れる。

## 5. 利用者とのやりとりのしかた

- スマホからの音声入力が多い。言い間違い・変換違いがあるので、意味をくみ取る。わからなければ短く聞く。
- 返事は日本語で、専門用語を避け、短く。Gemini など他のAIの文を貼ってくることが多いが、事実としてではなく「提案」として扱い、確かめる。
- 鍵(APIキー・トークン)はチャットに貼らせない。Render などの設定画面に直接入れてもらう。
- プルリクエストは頼まれたときだけ作る(「プルリク作ってマージして」と言われることが多い。CI が通ってからマージ)。
- 守る決まり(CLAUDE.md より抜粋): 声のクローンを入れない/AIが自分で110番・警察への自動送信をしない/「警察に中継」など事実でない安心材料を書かない/
  AIは約束(振り込む・渡す・行く・待つ)や架空の口座番号を言わない/電話を切る・AIに代わるのは本人の操作だけ/相手の口座をSNSに出さない。

## 6. 公開済みのページ(claude.ai の Artifact、持ち主だけが見られる)

- LP(下書き): https://claude.ai/artifact/HpkZQuU3419iAA6tLhrdae
- スマホだけで置く手順: https://claude.ai/artifact/CakWGLbuxPjbqWXLTYTWZg
- 警察署ヒアリング(22問): https://claude.ai/artifact/NkNF6YseHc6CGhtWibNUDJ
- 固定電話の設定: https://claude.ai/artifact/T7KQr6cSLmrsu8WAPUV2ot
- パソコンでやること: https://claude.ai/artifact/RznknMnYAQNhArgk9zk1qC
- 判定デモ: https://claude.ai/artifact/2GKELH7wQdgVEj2gocRSyt (古い版。今の検知ルールは `sengoku-shield/demo/index.html` にある)

## 7. 別リポジトリについて

- `marimo530122-cmyk/sengoku-shield`(Next.js、Vercel の sengoku-shield.vercel.app)は9月初めに作った古い別版。今は使っていない。
  画面の「DASHBOARD_PASSWORD が未設定です」は、合言葉が無いので鍵をかけて止めているだけ。
