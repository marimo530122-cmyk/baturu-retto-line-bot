// AIおとり応答: 相手の発話に対して「のんびりした一般人」として返事をし、時間を稼ぐ
//
// ANTHROPIC_API_KEY が無い・APIが失敗/拒否した・タイムアウトした場合は、
// 固定の「時間稼ぎフレーズ」をローテーションで返す(電話は止めない)。

const AI_MODEL = process.env.SHIELD_AI_MODEL || "claude-opus-5";
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
- 相手が普通の用件(宅配・家族・知人など)に見えるときは、「この電話は自動応答です。ご用件は後ほど確認します」と丁寧に伝える。

返事の本文だけを出力してください。`;

const STALL_PHRASES = [
  "はいはい、ちょっと耳が遠くて。もう一度ゆっくりお願いできますか。",
  "あら、そうなんですか。えーと、それはどういうことでしょう。",
  "ちょっと待ってくださいね、メガネを探してきますから。",
  "すみません、今お湯を沸かしてて。なんのお話でしたっけ。",
  "うーん、難しいお話ですねえ。もう少し詳しく教えてもらえますか。",
  "なるほどねえ。ところで、どちらさまでしたっけ。",
  "メモを取りますので、最初からもう一度お願いします。",
];

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
function isSafeReply(text) {
  if (!text || text.length > 120) return false;
  // 4桁以上の数字列(番号っぽいもの)は読み上げない
  if (/\d{4,}|[0-9０-９]{4,}/.test(text)) return false;
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

async function reply(history, turn) {
  if (!USE_AI) return { text: stallPhrase(turn), source: "fixed" };
  const messages = toMessages(history);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { text: stallPhrase(turn), source: "fixed" };
  }
  try {
    const response = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      // 安全分類器に止められた場合は、サーバー側で自動的に別モデルで再実行させる
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages,
    });
    if (response.stop_reason === "refusal") {
      return { text: stallPhrase(turn), source: "fixed(refusal)" };
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!isSafeReply(text)) return { text: stallPhrase(turn), source: "fixed(rule)" };
    return { text, source: "ai" };
  } catch (err) {
    console.error("[decoy] AI応答に失敗したので固定文面を使います:", err.message);
    return { text: stallPhrase(turn), source: "fixed(error)" };
  }
}

module.exports = { reply, stallPhrase, isSafeReply, toMessages, SYSTEM_PROMPT, STALL_PHRASES };
