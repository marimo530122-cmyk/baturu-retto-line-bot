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
const { BUILTIN_PATTERNS } = require("./detector");

// 聞き出す手がかり
const TARGETS = [
  { key: "identity", label: "名前と所属", has: (t) => t.has("person") && t.has("org") },
  { key: "bank", label: "銀行名と支店", has: (t) => t.has("bank") },
  { key: "account", label: "口座番号", has: (t) => t.has("account") },
  { key: "meeting", label: "受け渡しの日時と場所", has: (t) => t.has("visit") || (t.has("datetime") && t.has("place")) },
  { key: "person", label: "相手の名前", has: (t) => t.has("person") },
  { key: "amount", label: "金額", has: (t) => t.has("amount") },
  { key: "phone", label: "折り返しの電話番号", has: (t) => t.has("phone") },
];
const BY_KEY = Object.fromEntries(TARGETS.map((t) => [t.key, t]));

// 聞く順番。受け子の検挙と口座の凍結に直接つながる「振込先」「受け渡しの日時と場所」を先に聞く。
// 警察・役所を名乗ったときは、まず名前と所属を聞く(「警察の方ならメモを残したい」と言えば自然で、
// 後で本物かどうか警察署に確かめられる)。名前と所属を聞いたので、別に名前だけを聞くことはしない。
// 地元(藤枝署)で多い、ニセ警察官がカード・現金を受け取りに来る/振り込ませる手口に合わせた順番(docs/fujieda_scam_context.md)。
const ORDER_AUTHORITY = ["identity", "bank", "account", "meeting", "amount", "phone"];
const ORDER_DEFAULT = ["bank", "account", "meeting", "person", "amount", "phone"];

// 警察・役所などを名乗っているか
const AUTHORITY = /警察|刑事|捜査|県警|府警|警視庁|金融庁|検察|市役所|区役所|役場|年金事務所|税務署/;
const POLICE = /警察|刑事|捜査|県警|府警|警視庁/;

function claimsAuthority(lines) {
  return AUTHORITY.test(lines.join(" "));
}

// 「守秘義務があるから誰にも言うな」などの口止め(検知ルールの口止め・口裏合わせと同じ判定を使う)
const GAG_RULES = BUILTIN_PATTERNS.filter((p) => p.id === "secrecy" || p.id === "bank_cover_story").map((p) => p.regex);

function isGag(line) {
  const text = String(line || "");
  return GAG_RULES.some((re) => re.test(text));
}

// 相手の話に出てきたことに合わせて、聞く価値のあるものだけに絞る
// (振込の話が出ていないのに口座を聞くと不自然なので)
// method: Jevが判定した、お金の動かし方(transfer / handover)。言い換えで言葉に出ていないときの補い
function relevantTargets(lines, { method = null } = {}) {
  const text = lines.join(" ");
  const talksTransfer = /振り?込|口座|ATM|送金|入金/.test(text) || method === "transfer";
  // 「ATMで受け取れます」(還付金)のように、お金が戻ってくる話の「受け取」は受け渡しに数えない
  const talksHandover = /渡し|受け取りに|取りに|伺|回収|封筒|現金|示談金|預か/.test(text) || method === "handover";
  const order = claimsAuthority(lines) ? ORDER_AUTHORITY : ORDER_DEFAULT;
  return order
    .map((key) => BY_KEY[key])
    .filter((t) => {
      if (t.key === "bank" || t.key === "account") return talksTransfer;
      if (t.key === "meeting") return talksHandover;
      return true;
    });
}

function missingTargets(callerLines, opts) {
  const types = new Set(intel.extract(callerLines).map((f) => f.type));
  return relevantTargets(callerLines, opts).filter((t) => !t.has(types));
}

// 相手が怪しみ始めた・いら立っている・切ろうとしている、を言葉から見る(Jevが使えないときの目安)
const SUSPICION = /(本当に|ちゃんと)(聞いて|分かって)|ふざけ|もういい|話にならない|機械|ロボット|録音|誰(と|か)(話|いる)|さっきから|早くして|いい加減|切ります|また(かけ|電話)/;

function looksSuspicious(lastCallerLine) {
  return SUSPICION.test(String(lastCallerLine || ""));
}

// AIが使えないとき・AIの返事を使えなかったときの、聞き出し用の決まった言い方
const ASK_PHRASES = {
  bank: "その銀行、このへんで聞かない名前でねえ。どこの銀行の、何支店って書けばいいかね。",
  account: "番号の最後のところが聞き取れなくてねえ。頭から、一つずつ区切って言ってもらえますか。",
  person: "お名前、なんておっしゃいましたっけ。メモしておきますね。",
  amount: "それで、全部でおいくらって言いましたっけ。",
  meeting: "えーと、いつ、どこのことでしたっけ。もう一度ゆっくりお願いします。",
  phone: "何かあったら、どちらの番号にかけ直せばいいんでしたっけ。",
  identity: "メモをちゃんと残したいので、お名前と、どちらの何課の方か、もう一度教えてもらえますか。",
};

// 警察を名乗った相手に、名前と所属を聞き返す言い方
const ASK_IDENTITY_POLICE = "警察の方なら、メモをちゃんと残したいので、お名前と所属をもう一度教えてもらえますか。";

// 口止めされたときに、話を合わせて相手を安心させる言い方。
// 相手に言うだけで、本当に黙るわけではない(家族への知らせは、鮮刻シールドがいつも通り送る)。
const GAG_CALM = "分かりました、誰にも言いませんから安心してください。";

function askPhrase(target, { police = false } = {}) {
  if (target.key === "identity" && police) return ASK_IDENTITY_POLICE;
  return ASK_PHRASES[target.key];
}

// 怪しまれたときの、話を合わせてつなぎ止める言い方(約束はしない)
const CALM_PHRASES = [
  "怒らないでちょうだい、ちゃんとメモするから。もう一度だけお願いできますか。",
  "親切に教えてくれてるのに、申し訳ないねえ。年を取ると、どうも物覚えが悪くて。",
  "ごめんなさいね。ちゃんと聞いてますよ。年を取ると、どうも物覚えが悪くて。",
  "すみませんねえ、耳が遠くて。ゆっくりでいいので、もう一度お願いできますか。",
  "はいはい、大丈夫ですよ。今、メモを探してきましたから。",
];

// Claudeへの指示(今この瞬間の作戦)を作る
function guidance({ missing, suspicious, gagged = false, police = false }) {
  if (suspicious) {
    return (
      "【今の作戦】相手が怪しみ始めているか、いら立っています。今は手がかりを聞かず、" +
      "「怒らないでちょうだい、ちゃんとメモするから」「親切に教えてくれてるのに申し訳ないねえ」のように、下手に出て相手をなだめ、" +
      "会話を1往復でも長く続けさせてください。約束はしないこと。"
    );
  }
  if (gagged) {
    const next = missing[0];
    const ask = !next
      ? "そのあとは、約束はせずにゆっくり時間をかせいでください。"
      : next.key === "identity"
        ? `続けて「${police ? ASK_IDENTITY_POLICE : ASK_PHRASES.identity}」のように、メモを残したいからと言って名前と所属を聞き返してください。`
        : `続けて、メモを取るふりをして「${next.label}」を1つだけ聞き返してください。`;
    return (
      "【今の作戦】相手に「誰にも言うな」と口止めされました。逆らったり問い詰めたりせず、" +
      `まず「${GAG_CALM}」と話を合わせて相手を安心させてください。${ask}` +
      "口止めを守る以外の約束(振り込む・渡す・行く・待つ)はしないこと。"
    );
  }
  if (!missing.length) {
    return "【今の作戦】必要な手がかりはそろいました。約束はせず、聞き返したり話をそらしたりして、ゆっくり時間をかせいでください。";
  }
  const identityHint =
    missing[0].key === "identity"
      ? `(例:「${police ? ASK_IDENTITY_POLICE : ASK_PHRASES.identity}」)`
      : "(例:「メモしますから、もう一度ゆっくりお願いします」)";
  return (
    `【今の作戦】まだ聞けていない手がかり: ${missing.map((m) => m.label).join("、")}。` +
    `今回の返事では「${missing[0].label}」を、メモを取るふりをして自然に1つだけ聞き返してください` +
    `${identityHint}。相手が言ったことを、こちらから先に言わないこと。約束はしないこと。`
  );
}

// 決まった言い方から、直前に言っていないものを選ぶ
function fallbackPhrase({ missing, suspicious, gagged = false, police = false, recentShieldLines = [], turn = 0 }) {
  const said = new Set(recentShieldLines);
  let candidates = [];
  if (suspicious) candidates = CALM_PHRASES;
  else if (gagged) {
    // 口止めには、その場ですぐ話を合わせる(交互にしない)。続けて次の手がかりを1つ聞く
    candidates = [missing[0] ? `${GAG_CALM}${askPhrase(missing[0], { police })}` : GAG_CALM, GAG_CALM];
  } else if (missing.length && turn % 2 === 1) candidates = missing.map((m) => askPhrase(m, { police }));
  return candidates.find((p) => !said.has(p)) || null;
}

// 相手の発言から、今の場面(警察を名乗っているか・今まさに口止めされたか)を見る
function scene(callerLines) {
  return {
    authority: claimsAuthority(callerLines),
    police: POLICE.test(callerLines.join(" ")),
    gagged: isGag(callerLines[callerLines.length - 1]),
  };
}

module.exports = {
  TARGETS,
  scene,
  isGag,
  claimsAuthority,
  GAG_CALM,
  ASK_IDENTITY_POLICE,
  missingTargets,
  looksSuspicious,
  guidance,
  fallbackPhrase,
  ASK_PHRASES,
  CALM_PHRASES,
};
