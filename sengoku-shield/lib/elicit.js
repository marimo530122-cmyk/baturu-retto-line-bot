// 聞き出しの作戦: AIが代わりに話している間、警察に渡す手がかりのうち「まだ聞けていないもの」を、
// メモを取るふりで1つずつ聞き返す。相手が怪しみ始めたら聞くのをやめて話を合わせ、つなぎ止める。
//
// 参考にした考え方(海外の詐欺対策ハニーポットOSSで使われている設計):
// - 抜き出した情報をもとに、次に聞くことを決める(足りない手がかりを狙う)
// - 相手の様子(協力的 / 怪しんでいる / 切ろうとしている)で話し方を変える
// - 同じ返事を繰り返さない(繰り返すと機械だとばれる)
//
// どの場合も、振り込む・渡す・行く・待つといった約束はしない(lib/decoy.js の COMMITMENT で止める)。

const intel = require("./intel");

// 聞く順番(受け子の検挙・口座の凍結に効くものから)
const TARGETS = [
  { key: "bank", label: "銀行名と支店", has: (t) => t.has("bank") },
  { key: "account", label: "口座番号", has: (t) => t.has("account") },
  { key: "person", label: "相手の名前", has: (t) => t.has("person") },
  { key: "amount", label: "金額", has: (t) => t.has("amount") },
  { key: "meeting", label: "受け渡しの日時と場所", has: (t) => t.has("visit") || (t.has("datetime") && t.has("place")) },
  { key: "phone", label: "折り返しの電話番号", has: (t) => t.has("phone") },
];

// 相手の話に出てきたことに合わせて、聞く価値のあるものだけに絞る
// (振込の話が出ていないのに口座を聞くと不自然なので)
function relevantTargets(lines) {
  const text = lines.join(" ");
  const talksTransfer = /振り?込|口座|ATM|送金|入金/.test(text);
  const talksHandover = /渡し|受け取|取りに|伺|回収|封筒|現金|示談金/.test(text);
  return TARGETS.filter((t) => {
    if (t.key === "bank" || t.key === "account") return talksTransfer;
    if (t.key === "meeting") return talksHandover;
    return true;
  });
}

function missingTargets(callerLines) {
  const types = new Set(intel.extract(callerLines).map((f) => f.type));
  return relevantTargets(callerLines).filter((t) => !t.has(types));
}

// 相手が怪しみ始めた・いら立っている・切ろうとしている、を言葉から見る(Jevが使えないときの目安)
const SUSPICION = /(本当に|ちゃんと)(聞いて|分かって)|ふざけ|もういい|話にならない|機械|ロボット|録音|誰(と|か)(話|いる)|さっきから|早くして|いい加減|切ります|また(かけ|電話)/;

function looksSuspicious(lastCallerLine) {
  return SUSPICION.test(String(lastCallerLine || ""));
}

// AIが使えないとき・AIの返事を使えなかったときの、聞き出し用の決まった言い方
const ASK_PHRASES = {
  bank: "ごめんなさい、メモしますから、どこの銀行の、何支店でしたっけ。",
  account: "えーと、口座の番号を、もう一度ゆっくり言ってもらえますか。書き写しますから。",
  person: "お名前、なんておっしゃいましたっけ。メモしておきますね。",
  amount: "それで、全部でおいくらって言いましたっけ。",
  meeting: "えーと、いつ、どこのことでしたっけ。もう一度ゆっくりお願いします。",
  phone: "何かあったら、どちらの番号にかけ直せばいいんでしたっけ。",
};

// 怪しまれたときの、話を合わせてつなぎ止める言い方(約束はしない)
const CALM_PHRASES = [
  "ごめんなさいね。ちゃんと聞いてますよ。年を取ると、どうも物覚えが悪くて。",
  "すみませんねえ、耳が遠くて。ゆっくりでいいので、もう一度お願いできますか。",
  "はいはい、大丈夫ですよ。今、メモを探してきましたから。",
];

// Claudeへの指示(今この瞬間の作戦)を作る
function guidance({ missing, suspicious }) {
  if (suspicious) {
    return (
      "【今の作戦】相手が怪しみ始めているか、いら立っています。今は手がかりを聞かず、" +
      "「ちゃんと聞いてますよ」「年を取ると物覚えが悪くて」のように、相手をなだめて話を続けさせてください。約束はしないこと。"
    );
  }
  if (!missing.length) {
    return "【今の作戦】必要な手がかりはそろいました。約束はせず、聞き返したり話をそらしたりして、ゆっくり時間をかせいでください。";
  }
  return (
    `【今の作戦】まだ聞けていない手がかり: ${missing.map((m) => m.label).join("、")}。` +
    `今回の返事では「${missing[0].label}」を、メモを取るふりをして自然に1つだけ聞き返してください` +
    "(例:「メモしますから、もう一度ゆっくりお願いします」)。相手が言ったことを、こちらから先に言わないこと。約束はしないこと。"
  );
}

// 決まった言い方から、直前に言っていないものを選ぶ
function fallbackPhrase({ missing, suspicious, recentShieldLines = [], turn = 0 }) {
  const said = new Set(recentShieldLines);
  const candidates = suspicious
    ? CALM_PHRASES
    : missing.length && turn % 2 === 1
      ? missing.map((m) => ASK_PHRASES[m.key])
      : [];
  return candidates.find((p) => !said.has(p)) || null;
}

module.exports = {
  TARGETS,
  missingTargets,
  looksSuspicious,
  guidance,
  fallbackPhrase,
  ASK_PHRASES,
  CALM_PHRASES,
};
