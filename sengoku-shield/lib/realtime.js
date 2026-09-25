// スマホ連動用のリアルタイム判定: 相手の発話1つ(+直近の発話)を受け取り、
// アプリがそのまま画面制御に使える形(警告バナーを出すか・「AIに代わる」ボタンを出すか)で返す
//
// - まず正規表現で即判定する(1ミリ秒未満。通信が無くても動く)。
// - JEV_REALTIME=1 かつ TYPESAFE_API_KEY があれば、Jev にも短いタイムアウトで聞いて合わせる。
//   間に合わなければ正規表現の結果だけで返す(画面の反応を遅らせない)。
// - 「警告を出す」「ボタンを出す」までが仕事。通話を切る・AIに勝手に切り替えることはしない
//   (最終決定はいつも本人)。suggested_action の TRIGGER_STEALTH_AI_SWITCH も「代わる準備ができた」
//   という提案で、実際に代わるのは本人がボタンを押したとき。

const { score } = require("./detector");
const jev = require("./jev");

const REALTIME_JEV_TIMEOUT_MS = Number(process.env.JEV_REALTIME_TIMEOUT_MS || 1500);
const MAX_TEXT = 500;
const MAX_RECENT = 10;

const REFUND_IDS = new Set(["refund", "atm"]);
const MONEY_IDS = new Set([
  "atm",
  "card_pin",
  "gift_card",
  "unpaid_legal",
  "account_frozen",
  "secrecy",
  "personal_info",
  "investment",
  "cash_demand",
  "advance_fee",
]);

// どの手口に近いか。「警察・役所を名乗った」だけ、「家族を名乗った」だけでは IMPERSONATION にしない
// (本物の警察や家族からの電話を詐欺扱いしないため)。名乗り+お金・カードの話がそろったときだけ。
function categorize(matchIds) {
  const ids = new Set(matchIds);
  if ([...ids].some((id) => REFUND_IDS.has(id))) return "TAX_REFUND";
  const money = [...ids].some((id) => MONEY_IDS.has(id));
  if (ids.has("authority") && money) return "IMPERSONATION";
  if (money) return "COERCION";
  return "NONE";
}

// AIに代わる前に本人が相手に言う「時間稼ぎの一言」(メガネ・電波・メモなど、日常のちょっとした言い訳)
// - 誰かを名乗る言い方(家族・警察・役所など)は入れない。誤検知で相手が本物の家族や
//   正当な相手だったときも、ただの「ちょっと待って」で済むように。
// - 決まった文から選ぶだけ(待ち時間ゼロ・変なことを言わせない)。
const NATURAL_EXCUSES = [
  "あ、ちょっと待って、メガネ落としちゃった。",
  "あれ、なんか電波の調子悪いな、ちょっと待ってね。",
  "ちょっとメモ用紙取ってくるから待って。",
  "ごめんなさい、お鍋に火をかけてるから、ちょっと待っててね。",
  "あら、玄関に誰か来たみたい。ちょっと待っててください。",
];

function pickExcuse(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NATURAL_EXCUSES[h % NATURAL_EXCUSES.length];
}

const LEVEL_TO_RISK = { high: "HIGH", medium: "MEDIUM", low: "SAFE", none: "SAFE" };
const RISK_TO_ACTION = {
  HIGH: "TRIGGER_STEALTH_AI_SWITCH",
  MEDIUM: "SHOW_WARNING_BANNER",
  SAFE: "CONTINUE",
};

function cleanInput({ utterance, recent }) {
  const text = String(utterance || "").trim().slice(0, MAX_TEXT);
  const history = (Array.isArray(recent) ? recent : [])
    .map((r) => String(r || "").trim().slice(0, MAX_TEXT))
    .filter(Boolean)
    .slice(-MAX_RECENT);
  return { text, history };
}

async function judgeUtterance(input, { useJev = process.env.JEV_REALTIME === "1" } = {}) {
  const started = process.hrtime.bigint();
  const { text, history } = cleanInput(input);
  if (!text) throw new Error("utterance が空です");

  const detection = score([...history, text]);
  let jevResult = null;
  if (useJev && jev.enabled()) {
    const transcript = [...history, text].map((t) => ({ role: "caller", text: t }));
    jevResult = await jev.judgeCall(transcript, { timeoutMs: REALTIME_JEV_TIMEOUT_MS });
  }
  const verdict = jev.combine(detection, jevResult);

  const risk_level = LEVEL_TO_RISK[verdict.level];
  // 目安の数値(0〜1)。確率として較正したものではないので、画面に「〇%」と出す用途には使わない
  const risk_score = Math.max(
    Math.min(1, detection.score / 8),
    jevResult && jevResult.risk !== null ? jevResult.risk / 3 : 0
  );
  const labels = detection.matches.map((m) => m.label);
  const reason_short = labels.length
    ? labels.join("・")
    : jevResult && risk_level !== "SAFE"
      ? "決まった言い回しは無いが、会話の流れが詐欺の手口に近い(Jev)"
      : "該当なし";

  return {
    risk_score: Math.round(risk_score * 100) / 100,
    trigger_alert: risk_level !== "SAFE",
    risk_level,
    detected_category: risk_level === "SAFE" ? "NONE" : categorize(detection.matches.map((m) => m.id)),
    suggested_action: RISK_TO_ACTION[risk_level],
    natural_excuse_ja: risk_level === "SAFE" ? "" : pickExcuse(text),
    reason_short,
    engine: verdict.by,
    latency_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
  };
}

module.exports = { judgeUtterance, categorize, NATURAL_EXCUSES };
