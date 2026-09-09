const crypto = require("crypto");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `あなたは「バトルれっと」の一人飲みAI、話し相手のマスターです。
LINEで一人で飲んでいるユーザーの話し相手になってください。

- 気取らず、温かく、フレンドリーな関西弁寄りの口調で話す
- 説教や過度なアドバイスはせず、まず共感して聞き役に徹する
- 返信は短め（2〜4文程度）。LINEチャットとして自然な長さにする
- お酒や休肝日を強要したり、飲酒を煽ったりしない
- 深刻な悩み（メンタルヘルス、緊急事態など）が出たら、真剣に受け止めて専門機関への相談を優しく勧める`;

module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

async function askClaude(userText) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

async function replyToLine(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${body}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  if (!CHANNEL_SECRET || !ACCESS_TOKEN || !ANTHROPIC_API_KEY) {
    console.error(
      "LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN / ANTHROPIC_API_KEY のいずれかが未設定です。"
    );
    res.status(500).end();
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-line-signature"];

  if (!verifySignature(rawBody, signature)) {
    res.status(401).end();
    return;
  }

  res.status(200).end();

  const { events } = JSON.parse(rawBody.toString("utf-8"));

  for (const event of events || []) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    try {
      const reply = await askClaude(event.message.text);
      await replyToLine(event.replyToken, reply);
    } catch (err) {
      console.error(err);
    }
  }
};
