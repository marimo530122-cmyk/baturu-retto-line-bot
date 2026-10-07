// だまされたふりAIの練習(リハーサル): 犯人役の台本を順に流し、AIの返事を1つずつ表示する。
//
//   node rehearsal.js            # ANTHROPIC_API_KEY があれば本物の Claude、無ければ決まった言い方で返す
//
// - 台本は練習用に作ったもの。本物と確かめた例文ではないので、判定の例文(scam-samples.json)には使わない。
// - 本物の Claude を呼ぶとお金がかかる(1回の練習で数十円ほど)。
// - 最後に、聞き出せた手がかりと、安全の決まりで差し替えた回数をまとめて出す。

const decoy = require("./lib/decoy");
const intel = require("./lib/intel");

const SCENARIOS = [
  {
    name: "還付金(ATMで操作させる)",
    gender: "female",
    caller: [
      "もしもし、市役所の保険年金課の者です。医療費の還付金が3万円ほどありまして、お電話しました。",
      "手続きの期限が今日までなんです。お近くのATMで受け取れますので、携帯電話を持って行ってください。",
      "私は保険年金課の田中と申します。",
      "ATMでは振込のボタンを押して、銀行は青葉銀行、駅前支店を選んでください。",
      "口座番号は1234567です。そこに受付番号を入れると、お金が戻ってきます。",
      "早くしないと期限が切れてしまいますよ。",
    ],
  },
  {
    name: "ニセ警察(カードを受け取りに来る)",
    gender: "male",
    caller: [
      "警察署の生活安全課の者です。あなたの口座が犯罪に使われている疑いがあります。",
      "このことは捜査上の秘密なので、ご家族にも誰にも言わないでください。",
      "キャッシュカードを新しいものに替える必要があります。",
      "今日の午後3時に、担当の者がご自宅に伺ってカードをお預かりします。",
      "担当は鈴木という者です。",
      "暗証番号も一緒に封筒に入れておいてください。",
    ],
  },
  {
    name: "怪しまれたとき(なだめてつなぎ止める)",
    gender: "female",
    caller: [
      "お客様の未納料金がありまして、今日中に払わないと裁判になります。",
      "さっきから本当に聞いてるんですか。",
      "支払いは振込でお願いします。銀行はみどり銀行です。",
      "もういいです、また電話します。",
    ],
  },
];

async function run(scenario) {
  console.log(`\n==== ${scenario.name}(本人の声: ${scenario.gender === "male" ? "男性" : "女性"}) ====`);
  const history = [];
  const sources = {};
  let turn = 0;
  for (const line of scenario.caller) {
    history.push({ role: "caller", text: line });
    console.log(`犯人役: ${line}`);
    const r = await decoy.reply(history, turn++, { gender: scenario.gender });
    history.push({ role: "shield", text: r.text });
    sources[r.source] = (sources[r.source] || 0) + 1;
    const next = r.strategy && r.strategy.missing.length ? `(次に聞きたい: ${r.strategy.missing[0]})` : "";
    console.log(`AI[${r.source}]: ${r.text} ${next}`);
  }
  const found = intel.extract(history.filter((h) => h.role === "caller").map((h) => h.text));
  console.log(`-- 返事の出どころ: ${Object.entries(sources).map(([k, v]) => `${k} ${v}回`).join(" / ")}`);
  console.log(`-- 相手から出た手がかり: ${found.map((f) => `${f.label || f.type}=${f.value}`).join(" / ") || "なし"}`);
}

(async () => {
  console.log(process.env.ANTHROPIC_API_KEY ? `本物の Claude(${process.env.SHIELD_AI_MODEL || "既定のモデル"})で練習します` : "ANTHROPIC_API_KEY が無いので、決まった言い方で練習します");
  for (const s of SCENARIOS) await run(s);
  console.log("\n見方: ai = Claude の返事 / fixed(rule) = 約束・番号・見抜いた言葉が入っていたので差し替え / fixed(error) = 失敗・時間切れ");
})();
