const crypto = require("crypto");

// Twilio からのリクエストかを X-Twilio-Signature で検証する
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
function isValidSignature(authToken, signature, url, params) {
  if (!authToken || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf-8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// 読み上げの声。SHIELD_VOICE_GENDER=male なら男性の声(Polly.Takumi)、それ以外は女性の声(Polly.Mizuki)。
// TWILIO_VOICE を指定すればそちらが優先。
const VOICE =
  process.env.TWILIO_VOICE ||
  (process.env.SHIELD_VOICE_GENDER === "male" ? "Polly.Takumi" : "Polly.Mizuki");

function say(text) {
  return `<Say language="ja-JP" voice="${escapeXml(VOICE)}">${escapeXml(text)}</Say>`;
}

// 相手の発話を音声認識で受け取り、action に POST させる
function gather(action, innerXml = "") {
  return (
    `<Gather input="speech" language="ja-JP" speechTimeout="auto" timeout="8" ` +
    `action="${escapeXml(action)}" method="POST">${innerXml}</Gather>`
  );
}

function twiml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

module.exports = { isValidSignature, escapeXml, say, gather, twiml };
