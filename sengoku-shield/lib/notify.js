// 疑いが「高」の通話が終わったら、持ち主のLINEに知らせる(任意)
// LINE_CHANNEL_ACCESS_TOKEN と SHIELD_LINE_USER_ID が両方あるときだけ動く

const { maskPhone } = require("./mask");

async function notifyOwner(call) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.SHIELD_LINE_USER_ID;
  if (!token || !to) return false;

  const text = [
    "【戦国シールド】詐欺の疑いがある電話に自動応答しました",
    `相手: ${maskPhone(call.from)}`,
    `通話時間: 約${call.durationSec || "?"}秒`,
    `判定: ${call.verdict.label}`,
    call.detection.matches.length
      ? `手口: ${call.detection.matches.map((m) => m.label).join("、")}`
      : "手口: (決まった言い回しは無し。会話の流れから判定)",
    "※自動判定です。折り返し電話はしないでください。",
  ].join("\n");

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    console.error(`[notify] LINE通知に失敗: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

module.exports = { notifyOwner };
