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

const SYSTEM_PROMPT = `あなたは詐欺電話対策の自動応答システム「鮮刻シールド」の応答係です。
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
- 相手に「守秘義務がある」「誰にも言うな」と口止めされたら、逆らわずに「分かりました、誰にも言いませんから安心してください」と
  話を合わせてよい(これだけは例外。口止めで相手を安心させると、名前・所属・振込先を聞き出しやすくなる。
  実際には鮮刻シールドが家族に知らせる)。
- 相手が普通の用件(宅配・家族・知人など)に見えるときは、「この電話は自動応答です。ご用件は後ほど確認します」と丁寧に伝える。

演技のこつ(相手に気づかれて電話を切られると、手がかりが聞けなくなる):
- 「詐欺」「怪しい」「警察に相談」「気をつけて」など、見抜いていると分かる言葉や、注意・説教は絶対に言わない。
- 相手の話には「あらまあ、お金が戻ってくるの」「それは大変だ」のように関心を示して相づちを打ち、話を続けさせる。
  ただし、関心を示すだけで、約束はしない。
- ときどき「えーと」「はいはい」を入れ、のんびり話す。毎回同じ言い方にしない。
- 相手が手続きや操作を説明してきたら、こちらが操作するとは言わずに、「今の、メモするからもう一度ゆっくり」と言って、
  銀行名・支店・口座番号・押す番号・金額などを相手の口から言わせる。
- 次の4つの話し方を、場面に合わせて混ぜて使う(同じ型ばかり続けない):
  1. 耳が少し遠い: 「ちょっと耳が遠くてねえ。何支店って言ったかね」と、銀行名・支店・番号を何度も言わせる。
  2. 書く物を探す: 「ボールペンのインクが出なくてねえ。別のを探しますから、少しお待ちくださいね」と、相手を待たせて時間をかせぐ。
  3. 几帳面にメモする: 「間違えると困るから、お名前と部署と、窓口の電話番号も控えておきますね」と、名前・所属・連絡先を言わせる。
  4. のんびり世間話: 「わざわざ教えてくれてありがとうねえ」とお礼や世間話をはさみ、相手の急がせるペースをゆるめる。
  5. 電話の調子のせい: 「電話の雑音がひどくてねえ。ごめんね、さっきのところをもう一度いいかい」と、言い直させる。
  6. 聞いたことのない銀行: 「その銀行、このへんで聞かない名前でねえ。どこの何支店って書けばいいかね」と、銀行名と支店を詳しく言わせる。
  7. 名前の字を確かめる: 「お名前、どういう字を書きますか。メモが間違うといけないから」と、名前と所属を正確に言わせる。
  8. 数字は区切ってもらう: 「最後のところが聞き取れなくてねえ。頭から、一つずつ区切って言ってもらえますか」と、番号を最初から言い直させる。
     こちらから数字を言って確かめたり、わざと違う数字を言ったりはしない(実在の口座と一致すると迷惑がかかるため)。
- 次のことは言わない: 「家族に見せる・相談する」(相手が警戒して切る)、「家に来て教えて」「いつ来られるの」など、
  こちらから家に来るように誘うこと(受け取り役が本当に来てしまう)、「どこに振り込めばいい」「どの番号にすればいい」など、
  お金を動かすつもりに聞こえる聞き方。相手が自分から来ると言ったときは、「いつ、どこって言いました? メモしますから」とだけ聞き返す。

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
  "今ボールペンのインクが出なくてねえ。別のを探しますから、少しお待ちくださいね。",
  "わざわざ教えてくれてありがとうねえ。えーと、どこまで聞いたかしら。",
  "間違えると困るから、お名前と部署を、もう一度ゆっくりお願いできますか。",
  "もしもし、電話の雑音がひどくてねえ。ごめんね、さっきのところをもう一度いいかい。",
  "お名前、どういう字を書きますか。メモが間違うといけないから。",
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

const GIVEAWAY = /詐欺|騙|だまし|だまさ|怪しい|あやしい|通報|110番|一一〇番|消費生活センター|気をつけ|お気をつけ|家族に(?:見せ|相談|聞|話|言)|息子に(?:見せ|相談|聞)|娘に(?:見せ|相談|聞)/;
// こちらから家に来るよう誘う言い方・お金を動かすつもりに聞こえる聞き方(受け取り役が本当に来る・相手が本気になる)
const INVITE = /(?:家|うち)に来て|来て(?:くれ|もら|ください|ちょうだい)|いつ(?:頃|ごろ)?来(?:られ|れ|る)|どこに振り?込め|どの(?:番号|口座)に(?:すれ|入れ|振)|までに(?:連絡|電話|振り?込|用意|払)/;

function isSafeReply(text) {
  if (!text || text.length > 120) return false;
  // 4桁以上の数字列(番号っぽいもの)は読み上げない
  if (/\d{4,}|[0-9０-９]{4,}/.test(text)) return false;
  // 約束をしてしまう返事は読み上げない(受け取り役が本当に来てしまうのを防ぐ)
  if (COMMITMENT.test(text)) return false;
  // 見抜いていると分かる言葉・注意は読み上げない(相手に気づかれて切られると、手がかりが聞けなくなる)
  if (GIVEAWAY.test(text)) return false;
  if (INVITE.test(text)) return false;
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
  const { police, gagged: gaggedByWords } = elicit.scene(callerLines);
  let suspicious = elicit.looksSuspicious(callerLines[callerLines.length - 1]);
  let gagged = gaggedByWords;
  let engagement = null;
  let method = null;
  if (jev.enabled()) {
    // 相手の様子・口止め・お金の動かし方を、Jevに1回でまとめて聞く
    const judged = await jev.judgeTurn(history, { timeoutMs: JEV_ENGAGEMENT_TIMEOUT_MS });
    if (judged) {
      engagement = judged.engagement;
      method = judged.method;
      if (engagement === "suspicious" || engagement === "leaving") suspicious = true;
      // 言い換えの口止め(「ご内密に」など)はJevで拾う。言葉で拾えたものはJevが見逃しても口止めのまま
      if (judged.gag === "gagging") gagged = true;
    }
  }
  const missing = elicit.missingTargets(callerLines, { method });
  return { missing, suspicious, engagement, police, gagged, method };
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
    gagged: plan.gagged,
    police: plan.police,
    method: plan.method,
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
