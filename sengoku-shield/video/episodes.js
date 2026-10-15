// 操作手順動画の台本(1場面 = 1枚の画面 + ナレーション1つ)
//
// - kind: "card" は文字だけの説明画面、"shot" は本物の見守り画面(/app)を動かして撮った画面。
// - shot の act(page, h) で画面を操作し、目立たせたい所のセレクタを返す(赤い枠で囲む)。
//   h は capture.js の道具(相手の声を流す・待つ など)。
// - ナレーションは1場面60字くらいまで(字幕として画面下に全文を出すため)。
// - 事実でないこと(「警察に中継」など)や、まだ無い機能(公式LINE)を「できる」と言わない。
// - 相手のセリフは画面を動かすための作り話(検知ルールの例文には使わない)。

const APP_URL_TEXT = "sengoku-shield.onrender.com/app";

// 第3話・第4話で使う、相手(犯人役)のセリフ
const CALLER_LINES = [
  "もしもし、市役所の保険年金課です。",
  "医療費の還付金があります。今日中にATMで手続きしてください。",
  "このことは、ご家族にも誰にも言わないでください。",
];
const CALLER_LINES_AFTER = [
  "還付金は、全部で3万円になります。",
];

const episodes = [
  {
    id: "ep1",
    title: "第1話 はじめの準備",
    who: "ご家族の方が、最初に一度だけ",
    scenes: [
      {
        kind: "card",
        heading: "第1話 はじめの準備",
        lines: ["ご家族の方が、最初に一度だけ行います", "所要時間は5分ほどです"],
        narration: "鮮刻シールドの使い方、第1話は、はじめの準備です。ご家族の方が、最初に一度だけ行います。",
      },
      {
        kind: "card",
        heading: "見守り画面を開く",
        lines: ["Android は Chrome、iPhone は Safari で", APP_URL_TEXT, "開くまで1分ほどかかることがあります"],
        narration: "ご本人のスマホで、アンドロイドはクローム、アイフォーンはサファリを開き、この住所を入れます。開くまで1分ほどかかることがあります。",
      },
      {
        kind: "card",
        heading: "ホーム画面に置く",
        lines: ["Android: 右上の「⋮」→「ホーム画面に追加」", "iPhone: 下の共有ボタン →「ホーム画面に追加」", "次からはアイコンを押すだけで開けます"],
        narration: "次に、ホーム画面に置きます。アンドロイドは右上の点が三つのボタン、アイフォーンは共有ボタンから、ホーム画面に追加を選びます。",
      },
      {
        kind: "shot",
        heading: "合言葉を入れる",
        narration: "はじめて開くと、設定の画面が開いています。一番上の合言葉の欄に、教えてもらった合言葉を入れます。",
        act: async (page) => {
          await page.fill("#token", "demo-token");
          await page.dispatchEvent("#token", "change");
          return "#token";
        },
      },
      {
        kind: "shot",
        heading: "ご本人の声を選ぶ",
        narration: "AIが代わりに話すときの声です。ご本人に合わせて、女性か男性を選びます。",
        act: async (page) => {
          await page.check('input[name="gender"][value="female"]');
          return ".row.gender";
        },
      },
      {
        kind: "shot",
        heading: "声を聞き比べる",
        narration: "声を選ぶ、を開くと、候補が出ます。聞き比べて、ふつうのお年寄りらしい声で、これにする、を押します。",
        act: async (page) => {
          await page.evaluate(() => { document.getElementById("voicePick").open = true; });
          await page.locator("#voiceList button").nth(1).click();
          return "#voicePick";
        },
      },
      {
        kind: "shot",
        heading: "文字で試す",
        narration: "最後に、動くか確かめます。文字で試すの欄に、例えば、還付金があります、今日中にATMで手続きを、と入れて、判定する、を押します。",
        act: async (page) => {
          await page.fill("#testText", "還付金があります。今日中にATMで手続きしてください");
          return "#testText";
        },
      },
      {
        kind: "shot",
        heading: "警告が出れば準備完了",
        scrollTop: true,
        narration: "画面の上に、落ち着いてくださいね、という知らせが出れば、準備はできています。",
        act: async (page, h) => {
          await page.click("#testBtn");
          await h.waitFor(page, "#status.HIGH");
          return "#status";
        },
      },
      {
        kind: "shot",
        heading: "設定を閉じる",
        fresh: true,
        narration: "設定の見出しを押して閉じれば、おしまいです。ご本人は、この上の画面だけを見れば大丈夫です。",
        act: async (page) => {
          await page.evaluate(() => { document.getElementById("settings").open = false; });
          return "#startBtn";
        },
      },
    ],
  },
  {
    id: "ep3",
    title: "第3話 電話がかかってきたら",
    who: "ご本人が行います",
    scenes: [
      {
        kind: "card",
        heading: "第3話 電話がかかってきたら",
        lines: ["ご本人が行います", "ご家族の方は、一緒に練習してあげてください"],
        narration: "第3話は、電話がかかってきたときの使い方です。ご本人が行います。ご家族の方は、一緒に練習してあげてください。",
      },
      {
        kind: "card",
        heading: "まず、電話をスピーカーに",
        lines: ["電話に出たら、スピーカーにする", "鮮刻シールドのスマホを、電話のそばに置く"],
        narration: "知らない番号からの電話に出たら、電話をスピーカーにして、鮮刻シールドのスマホをそばに置きます。",
      },
      {
        kind: "shot",
        heading: "「聞き取りを始める」を押す",
        fresh: true,
        narration: "見守り画面を開いて、聞き取りを始める、を押します。はじめてのときは、マイクを許可してください。",
        act: async () => "#startBtn",
      },
      {
        kind: "shot",
        heading: "聞き取り中",
        narration: "聞き取り中、と出ます。あとは、いつもどおりお話ししてください。相手の言葉を、画面が見守ります。",
        act: async (page, h) => {
          await page.click("#startBtn");
          await h.waitFor(page, "#status.SAFE");
          return "#status";
        },
      },
      {
        kind: "shot",
        heading: "あやしいと「ポーン」",
        scrollTop: true,
        narration: "お金やATMの話など、あやしい言葉が出ると、ポーンと鳴って、スマホがふるえます。画面を見てください。",
        act: async (page, h) => {
          for (const line of CALLER_LINES) await h.callerSays(page, line);
          await h.waitFor(page, "#status.HIGH");
          return "#status";
        },
      },
      {
        kind: "shot",
        heading: "① 言い訳を声に出して言う",
        scrollTop: true,
        narration: "まず、①に出ている言葉を、そのまま相手に言います。メガネを落とした、などの、ちょっとした言い訳です。",
        act: async () => "#bridgeCard",
      },
      {
        kind: "shot",
        heading: "② ボタンを押す",
        scrollTop: true,
        narration: "言えたら、②のボタンを押します。代わるかどうかは、いつもご本人が決めます。押さなくても大丈夫です。",
        act: async () => "#handoffBtn",
      },
      {
        kind: "shot",
        heading: "AIがお話しします",
        scrollTop: true,
        narration: "ここからはAIが、ご本人のふりをして相手と話し、名前や場所などを聞き返して記録します。お金を払う約束はしません。",
        act: async (page, h) => {
          await page.click("#handoffBtn");
          await h.waitFor(page, "#status.AI");
          return "#status";
        },
      },
      {
        kind: "shot",
        heading: "こわくなったら、切ってOK",
        scrollTop: true,
        narration: "こわくなったら、電話を切っても大丈夫です。自分で話したくなったら、自分の応対に戻す、を押します。",
        act: async () => "#backBtn",
      },
    ],
  },
  {
    id: "ep4",
    title: "第4話 電話が終わったら",
    who: "ご本人が押すだけ。あとはご家族へ",
    scenes: [
      {
        kind: "card",
        heading: "第4話 電話が終わったら",
        lines: ["電話を切ったあとの使い方です", "ご本人は、ボタンを1つ押すだけです"],
        narration: "第4話は、電話を切ったあとの使い方です。ご本人は、ボタンを1つ押すだけです。",
      },
      {
        kind: "shot",
        heading: "「電話が終わったら押してください」",
        setup: "callInProgress",
        narration: "電話を切ったら、電話が終わったら押してください、のボタンを押します。",
        act: async () => "#stopBtn",
      },
      {
        kind: "shot",
        heading: "ご家族のLINEに自動で届きます",
        scrollTop: true,
        narration: "あやしい電話だったときは、ご家族のLINEに自動で知らせが届きます。ご本人は、ご家族からの連絡を待つだけで大丈夫です。",
        act: async (page, h) => {
          await page.click("#stopBtn");
          await h.waitFor(page, "#scriptCard:not(.hidden)");
          await page.evaluate(() => window.scrollTo(0, 0));
          return "#status";
        },
      },
      {
        kind: "card",
        heading: "ご家族に届く知らせ",
        lines: [
          "【鮮刻シールド】見守っていた電話が終わりました",
          "相手が言っていたこと(名乗り・金額など)",
          "110番で、そのまま読める文",
        ],
        narration: "ご家族には、相手が言っていたことと、110番でそのまま読める文が届きます。動揺しているご本人に代わって、ご家族が警察に相談できます。",
      },
      {
        kind: "shot",
        heading: "自分で相談したいときは",
        narration: "ご本人が自分で相談したいときは、この文を開いて、警察相談専用電話の、シャープきゅういちいちぜろ、で読みます。",
        act: async () => "#scriptDetails > summary",
      },
      {
        kind: "card",
        heading: "会う約束をされたら、すぐ110番",
        lines: ["相手が「何時にどこで会う」", "「家に取りに行く」と言ったら", "ご家族を待たずに、すぐ 110番"],
        narration: "ただし、相手が会う日時や場所、家に来る話をしていたら、ご家族を待たずに、すぐに110番してください。画面にも、そう出ます。",
      },
      {
        kind: "card",
        heading: "迷ったら、まず切る",
        lines: ["お金の話が出たら、まず電話を切る", "ご家族か、#9110 に相談する", "ご家族の登録は第2話で"],
        narration: "迷ったら、まず電話を切って、ご家族か、警察相談専用電話に相談してください。ご家族の登録のしかたは、第2話で説明します。",
      },
    ],
  },
];

module.exports = { episodes, CALLER_LINES, CALLER_LINES_AFTER, APP_URL_TEXT };
