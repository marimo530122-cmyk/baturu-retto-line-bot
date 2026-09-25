// 疑いが「高」の通話が終わったら、持ち主のLINEに知らせる(任意)
// LINE_CHANNEL_ACCESS_TOKEN と SHIELD_LINE_USER_ID が両方あるときだけ動く

const { maskPhone, maskText } = require("./mask");

async function pushLine(to, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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

// 見守り画面(/app)で「疑い:高」になった瞬間に、離れて暮らす家族のLINEへ知らせる(任意)
// - 送り先は SHIELD_FAMILY_LINE_IDS(カンマ区切り)。無ければ SHIELD_LINE_USER_ID
// - 1回の通話(見守りセッション)につき1回だけ
// - 会話の全文は送らない。手口の種類と、番号を伏せた短い抜粋だけ
function familyTargets() {
  const ids = (process.env.SHIELD_FAMILY_LINE_IDS || process.env.SHIELD_LINE_USER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ? ids : [];
}

function familyMessage(judgment, utterance) {
  const excerpt = maskText(utterance).slice(0, 40);
  return [
    "【戦国シールド】見守り中の電話で、詐欺の疑いが「高」になりました",
    `手口: ${judgment.reason_short}`,
    `相手の発言(一部): 「${excerpt}${utterance.length > 40 ? "…" : ""}」`,
    "",
    "電話が終わったころに、本人に電話をかけて様子を聞いてあげてください。",
    "お金・カード・暗証番号の話が出ていたら、#9110(警察相談専用電話)に相談できます。",
    "※自動判定です。普通の電話を誤って判定している場合もあります。",
  ].join("\n");
}

async function notifyFamily(judgment, utterance) {
  const targets = familyTargets();
  if (!targets.length) return false;
  const text = familyMessage(judgment, utterance);
  const results = await Promise.all(targets.map((to) => pushLine(to, text).catch(() => false)));
  return results.some(Boolean);
}

// 見守り中の経過を家族に知らせる(AIに代わった / 電話が終わった)。
// 警察へ中継しているなど、実際にしていないことは書かない。
function familyProgressMessage(type, { minutes, ai_replies } = {}) {
  if (type === "handoff") {
    return [
      "【戦国シールド】本人が「AIに代わってもらう」を押しました",
      "今、AIが相手と話して時間をかせいでいます。本人は電話のそばで待っています。",
      "電話が終わったら、もう一度お知らせします。",
    ].join("\n");
  }
  if (type === "ended") {
    const parts = [];
    if (Number.isFinite(minutes)) parts.push(`約${minutes}分`);
    if (Number.isFinite(ai_replies) && ai_replies > 0) parts.push(`AIの返事 ${ai_replies}回`);
    return [
      "【戦国シールド】見守っていた電話が終わりました" + (parts.length ? `(${parts.join("・")})` : ""),
      "本人に電話をかけて、お金やカードを渡す約束をしていないか、やさしく聞いてあげてください。",
      "心配なときは #9110(警察相談専用電話)に相談できます。",
    ].join("\n");
  }
  return null;
}

async function notifyFamilyProgress(type, extra) {
  const targets = familyTargets();
  const text = familyProgressMessage(type, extra);
  if (!targets.length || !text) return false;
  const results = await Promise.all(targets.map((to) => pushLine(to, text).catch(() => false)));
  return results.some(Boolean);
}

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

  return pushLine(to, text);
}

module.exports = {
  notifyOwner,
  notifyFamily,
  notifyFamilyProgress,
  familyTargets,
  familyMessage,
  familyProgressMessage,
};
