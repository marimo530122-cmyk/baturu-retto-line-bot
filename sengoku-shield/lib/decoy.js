// AIおとり応答: 相手の発話に対して「のんびりした一般人」として返事をし、時間を稼ぐ
//
// ANTHROPIC_API_KEY が無い・APIが失敗/拒否した・タイムアウトした場合は、
// 固定の「時間稼ぎフレーズ」をローテーションで返す(電話は止めない)。

const elicit = require("./elicit");
const jev = require("./jev");

const AI_MODEL = process.env.SHIELD_AI_MODEL || "claude-opus-5";
// 相手の様子をJevに聞くときの待ち時間(返事が遅れすぎないように短く)
const JEV_ENGAGEMENT_TIMEOUT_MS = Number(process.env.JEV_ENGAGEMENT_TIMEOUT_MS || 1500);
const USE_AI = Boolean(process.env.ANTHROPIC_API_KEY);

// Twilio の webhook は15秒でタイムアウトするので、AIはそれより十分短く打ち切る
const AI_TIMEOUT_MS = Number(process.env.SHIELD_AI_TIMEOUT_MS || 8000);

const SYSTEM_PROMPT = `あなたは詐欺電話対策の自動応答システム「戦国シールド」の応答係です。
かかってきた電話の相手に、ごく普通の一般人として、のんびり・丁寧に受け答えしてください。
目的は、相手の時間を無駄に使わせて、その間に他の人がだまされるのを防ぐことです。

必ず守るルール:
- 本物の個人情報(氏名・住所・生年月日・口座番号・暗証番号・カード番号・資産額など)は絶対に言わない。
  それらしい架空の番号も言わない(実在の誰かの番号と一致すると迷惑がかかるため)。
  聞かれたら「えーと、どこにしまったかしら」「メガネを探してきますね」などで話をそらす。
- 警察・役所・銀行など、実在の組織や人物を名乗らない。名前や続柄(息子・孫など)を聞かれても、
  特定の誰かを名乗らず「はいはい、聞いてますよ」などとはぐらかす。
- 予約・契約・申し込み・同意など、約束ごとは一切しない。「あとで確認しておきますね」で流す
  (相手が本物の業者や家族だった場合に、本人の代わりに勝手な約束をしてしまわないため)。相手を脅したり、罵ったり、挑発したりしない。
- 相手を詐欺師だと決めつけて非難しない。お金を払う・ATMに行く・カードを渡す、といった約束もしない。
- 1回の返事は日本語で1〜2文、60文字以内。電話で読み上げるので、記号・絵文字・括弧書きは使わない。
- 聞き返す、話がそれる、ゆっくり確認する、などで自然に会話を長引かせる。
- 相手の名前・所属・連絡先・振込先(銀行名・口座番号)・金額・日時・場所は、メモを取るふりをして
  「メモしますから、もう一度ゆっくりお願いします」「お名前、なんておっしゃいましたっけ」と聞き返してよい
  (相手の言った手がかりは、あとで警察への相談に使う)。
- ただし、振り込む・渡す・用意する・行く・会う・待っている、といった約束は、はっきりとも、あいまいにも絶対にしない。
  家の住所や、家にいる時間も言わない。約束を迫られたら「うーん、メガネが見つからなくて」などで話をそらす
  (約束すると、受け取り役が本当に家に来てしまい危ないため)。
- 相手が普通の用件(宅配・家族・知人など)に見えるときは、「この電話は自動応答です。ご用件は後ほど確認します」と丁寧に伝える。

返事の本文だけを出力してください。`;

const STALL_PHRASES = [
  "メモを取りますから、お名前をもう一度ゆっくりお願いできますか。",
  "えーと、どちらの何という所からのお電話でしたっけ。",
  "はいはい、ちょっと耳が遠くて。もう一度ゆっくりお願いできますか。",
  "へえ、そうなんですか。えーと、それはどういうことでしょう。",
  "ちょっと待ってくださいね、メガネを探してきますから。",
  "すみません、今お湯を沸かしてて。なんのお話でしたっけ。",
  "うーん、難しいお話ですねえ。もう少し詳しく教えてもらえますか。",
  "なるほどねえ。ところで、どちらさまでしたっけ。",
  "メモを取りますので、最初からもう一度お願いします。",
];

// 本人の声の性別に合わせた話し方(見守り画面の設定、または SHIELD_VOICE_GENDER)。
// 声そのものは合成音声のまま(本人の声を真似る機能は、なりすましに悪用できるので入れない)。
const GENDER_STYLE = {
  female: "話し方: 年配の女性らしい、やわらかい話し方にする(「そうなんですねえ」「あらまあ」など)。",
  male: "話し方: 年配の男性らしい、落ち着いた話し方にする(「そうかい」「うーん、なるほどなあ」など)。",
};

function normalizeGender(gender) {
  return Object.hasOwn(GENDER_STYLE, gender) ? gender : null;
}

function systemPrompt(gender) {
  const g = normalizeGender(gender);
  return g ? `${SYSTEM_PROMPT}\n\n${GENDER_STYLE[g]}` : SYSTEM_PROMPT;
}

function stallPhrase(turn) {
  return STALL_PHRASES[turn % STALL_PHRASES.length];
}

let client = null;
function getClient() {
  if (!client) {
    const Anthropic = require("@anthropic-ai/sdk");
    client = new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  }
  return client;
}

// AIの返事が電話で読み上げるのに適しているか(長すぎ・数字の羅列などを弾く)
// 約束に聞こえる言い方(振り込みます・渡します・行きます・待ってます 等)
const COMMITMENT =
  /(振り?込み|渡し|払い|用意し|準備し|持って(?:行|い)き|行き|伺い|会い|待ってい|お待ちし)(?:ます|ましょう|まーす)|(?:待って|行く|渡す|振り込む|払う|用意する)(?:ます|ね|よ|から)|お待ちして|わかりました|了解です|承知しました|そうします|(?:住所|家)は/;

function isSafeReply(text) {
  if (!text || text.length > 120) return false;
  // 4桁以上の数字列(番号っぽいもの)は読み上げない
  if (/\d{4,}|[0-9０-９]{4,}/.test(text)) return false;
  // 約束をしてしまう返事は読み上げない(受け取り役が本当に来てしまうのを防ぐ)
  if (COMMITMENT.test(text)) return false;
  return true;
}

// history: [{ role: "caller" | "shield", text }]
function toMessages(history) {
  const messages = [];
  for (const h of history) {
    const role = h.role === "caller" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += `\n${h.text}`;
    else messages.push({ role, content: h.text });
  }
  // 最初は必ず user、最後も user(相手の発話)で終わらせる
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages;
}

// 今の作戦(足りない手がかり・相手の様子)を決める。Jevが使えれば相手の様子はJevに聞く
async function planTurn(history) {
  const callerLines = history.filter((h) => h.role === "caller").map((h) => h.text);
  const missing = elicit.missingTargets(callerLines);
  let suspicious = elicit.looksSuspicious(callerLines[callerLines.length - 1]);
  let engagement = null;
  if (jev.enabled()) {
    engagement = await jev.judgeEngagement(history, { timeoutMs: JEV_ENGAGEMENT_TIMEOUT_MS });
    if (engagement === "suspicious" || engagement === "leaving") suspicious = true;
  }
  return { missing, suspicious, engagement };
}

// 決まった言い方から選ぶ(聞き出し・なだめ・時間稼ぎ)。直前に言ったことは繰り返さない
function fixedReply(plan, turn, recentShieldLines) {
  const phrase = elicit.fallbackPhrase({ ...plan, recentShieldLines, turn });
  if (phrase) return phrase;
  for (let i = 0; i < STALL_PHRASES.length; i++) {
    const p = stallPhrase(turn + i);
    if (!recentShieldLines.includes(p)) return p;
  }
  return stallPhrase(turn);
}

async function reply(history, turn, { gender = process.env.SHIELD_VOICE_GENDER } = {}) {
  const plan = await planTurn(history);
  const strategy = {
    missing: plan.missing.map((m) => m.label),
    suspicious: plan.suspicious,
    engagement: plan.engagement,
  };
  const recentShieldLines = history.filter((h) => h.role === "shield").slice(-4).map((h) => h.text);
  const fixed = (source) => ({ text: fixedReply(plan, turn, recentShieldLines), source, strategy });

  if (!USE_AI) return fixed("fixed");
  const messages = toMessages(history);
  if (!messages.length || messages[messages.length - 1].role !== "user") return fixed("fixed");
  try {
    const response = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      // 安全分類器に止められた場合は、サーバー側で自動的に別モデルで再実行させる
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 基本のルール + 今の作戦(足りない手がかりを聞く / なだめてつなぎ止める)
      system: `${systemPrompt(gender)}\n\n${elicit.guidance(plan)}`,
      messages,
    });
    if (response.stop_reason === "refusal") return fixed("fixed(refusal)");
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!isSafeReply(text)) return fixed("fixed(rule)");
    // 同じ返事の繰り返しは機械だとばれるので、決まった言い方に替える
    if (recentShieldLines.includes(text)) return fixed("fixed(repeat)");
    return { text, source: "ai", strategy };
  } catch (err) {
    console.error("[decoy] AI応答に失敗したので固定文面を使います:", err.message);
    return fixed("fixed(error)");
  }
}

module.exports = {
  reply,
  planTurn,
  fixedReply,
  stallPhrase,
  isSafeReply,
  toMessages,
  systemPrompt,
  normalizeGender,
  SYSTEM_PROMPT,
  STALL_PHRASES,
};
