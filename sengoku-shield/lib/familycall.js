// 家族への自動電話: LINEに気づかない家族にも、急ぎのときは自動音声の電話で知らせる
//
// かける相手: LINEで電話番号を登録した家族(lib/family.js)と、SHIELD_FAMILY_PHONES(カンマ区切り)
// 必要な設定: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / SHIELD_CALLER_ID(発信に使うTwilioの番号)
// AIが自分で110番することはしない(110番は人がかける番号なので、家族にお願いする)。

const family = require("./family");
const { escapeXml } = require("./twilio");

const VOICE = process.env.SHIELD_FAMILY_CALL_VOICE || "Polly.Mizuki";

function familyPhones() {
  const extra = (process.env.SHIELD_FAMILY_PHONES || "")
    .split(",")
    .map((s) => family.normalizePhone(s))
    .filter(Boolean);
  const registered = family.members().map((m) => m.phone).filter(Boolean);
  return [...new Set([...registered, ...extra])];
}

function ready() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.SHIELD_CALLER_ID);
}

// 電話で読み上げる文(短く、何をしてほしいかをはっきり)
function callMessage({ datetime, place, visit, bank, account, amount } = {}) {
  const lines = ["こちらは、戦国シールドです。", "見守っているご家族の電話で、詐欺と思われる電話がありました。"];
  if (datetime && place) lines.push(`相手は、${datetime}に、${place}で受け取ると言っています。`);
  else if (visit) lines.push("相手は、家に取りに来ると言っています。");
  if (amount) lines.push(`金額は、${amount}と言っています。`);
  if (bank || account) lines.push(`相手は、振込先として${bank ? `${bank}の` : ""}口座を言いました。口座番号はLINEに送りました。`);
  lines.push("本人が110番できていないようなら、代わりに110番をお願いします。");
  lines.push("くわしくは、戦国シールドのLINEを見てください。");
  return lines.join("");
}

function callTwiml(message) {
  // 聞き逃しても分かるように2回読み上げる
  const say = `<Say language="ja-JP" voice="${escapeXml(VOICE)}">${escapeXml(message)}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Pause length="1"/>${say}</Response>`;
}

async function placeCall(to, twiml) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
    body: new URLSearchParams({ To: to, From: process.env.SHIELD_CALLER_ID, Twiml: twiml }),
  });
  if (!res.ok) {
    console.error(`[familycall] 発信に失敗(末尾${to.slice(-4)}): ${res.status} ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

// 登録された家族全員に電話をかける。かけられた件数を返す
async function callFamily(info) {
  const phones = familyPhones();
  if (!ready() || !phones.length) return 0;
  const twiml = callTwiml(callMessage(info));
  const results = await Promise.all(phones.map((p) => placeCall(p, twiml).catch(() => false)));
  return results.filter(Boolean).length;
}

module.exports = { callFamily, callMessage, callTwiml, familyPhones, ready };
