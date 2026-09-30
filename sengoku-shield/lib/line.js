// 戦国シールドのLINE公式アカウント: 家族の登録を受け付ける
//
// LINE Developers の Messaging API チャネルで Webhook URL を <SHIELD_PUBLIC_URL>/line/webhook にする。
// 必要な環境変数: LINE_CHANNEL_SECRET(署名の確認)と LINE_CHANNEL_ACCESS_TOKEN(返信・通知)。

const crypto = require("crypto");
const family = require("./family");

function isValidSignature(rawBody, signature, secret = process.env.LINE_CHANNEL_SECRET) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function reply(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) return false;
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error(`[line] 返信に失敗: ${res.status} ${await res.text()}`);
  return res.ok;
}

// 登録した人の表示名(取れなければ空)
async function displayName(userId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return "";
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "";
    return (await res.json()).displayName || "";
  } catch {
    return "";
  }
}

const TEXT = {
  welcome:
    "戦国シールドです。友だち追加ありがとうございます。\n" +
    "見守るご家族の画面に出ている「6桁の招待番号」を、このトークに送ってください。",
  registered: (name) =>
    `見守り家族として登録しました${name ? `(${name}さん)` : ""}。\n` +
    "詐欺の疑いが高い電話があったとき、ここにお知らせが届きます。\n\n" +
    "急ぎのときに自動で電話も受けたい場合は、あなたの携帯電話の番号を送ってください(例: 090-1234-5678)。\n" +
    "登録をやめるときは「解除」と送ってください。",
  already: "すでに見守り家族として登録されています。登録をやめるときは「解除」と送ってください。",
  expired: "招待番号の期限が切れています。見守る方の画面で「家族を登録する」をもう一度押して、新しい番号を送ってください。",
  wrong: "招待番号がちがうようです。見守る方の画面に出ている6桁の数字を、もう一度送ってください。",
  locked: "まちがいが続いたため、登録を止めました。見守る方の画面で新しい招待番号を出してから、もう一度お試しください。",
  full: "登録できる家族の人数(10人)に達しています。見守る方の画面で、使っていない登録を消してください。",
  phoneSaved: (tail) =>
    `電話番号(末尾${tail})を登録しました。詐欺の疑いが高いときは、自動音声の電話でもお知らせします。`,
  phoneBad: "電話番号として読み取れませんでした。090-1234-5678 のように送ってください。",
  unregistered: "見守り家族の登録を解除しました。またいつでも招待番号で登録できます。",
  notMember: "まだ見守り家族として登録されていません。見守る方の画面に出ている「6桁の招待番号」を送ってください。",
};

// LINEから届いたイベントを1つ処理する(返信する文を返す。テストしやすいように返信そのものは呼び出し側)
async function handleEvent(event) {
  const userId = event?.source?.userId;
  if (!userId || event?.source?.type !== "user") return null;

  if (event.type === "follow") return family.isMember(userId) ? TEXT.already : TEXT.welcome;
  if (event.type === "unfollow") {
    family.removeByLineUser(userId);
    return null;
  }
  if (event.type !== "message" || event.message?.type !== "text") return null;

  const text = String(event.message.text || "").trim();
  if (/^解除$/.test(text)) return family.removeByLineUser(userId) ? TEXT.unregistered : TEXT.notMember;

  const code = text.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(code)) {
    const result = family.redeem(userId, code, await displayName(userId));
    if (result.ok) return result.already ? TEXT.already : TEXT.registered(result.member.name);
    return TEXT[result.reason];
  }

  const phone = family.normalizePhone(text);
  if (phone) {
    if (!family.isMember(userId)) return TEXT.notMember;
    family.setPhone(userId, phone);
    return TEXT.phoneSaved(phone.slice(-4));
  }
  if (/^[\d\s\-+()]{8,}$/.test(text)) return family.isMember(userId) ? TEXT.phoneBad : TEXT.notMember;

  return family.isMember(userId) ? TEXT.already : TEXT.notMember;
}

async function handleWebhook(body) {
  for (const event of body?.events || []) {
    try {
      const text = await handleEvent(event);
      if (text) await reply(event.replyToken, text);
    } catch (err) {
      console.error("[line] イベントの処理に失敗:", err.message);
    }
  }
}

module.exports = { isValidSignature, handleEvent, handleWebhook, TEXT };
