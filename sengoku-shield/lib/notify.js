// 疑いが「高」の通話が終わったら、持ち主のLINEに知らせる(任意)
// LINE_CHANNEL_ACCESS_TOKEN と SHIELD_LINE_USER_ID が両方あるときだけ動く

const { maskPhone, maskText } = require("./mask");
const family = require("./family");

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
// - 送り先は招待番号で登録した家族と、SHIELD_FAMILY_LINE_IDS(カンマ区切り。無ければ SHIELD_LINE_USER_ID)
// - 1回の通話(見守りセッション)につき1回だけ
// - 会話の全文は送らない。手口の種類と、番号を伏せた短い抜粋だけ
// 送り先 = 招待番号で登録した家族(data/family.json) + 設定で直接書いたID
function familyTargets() {
  const ids = (process.env.SHIELD_FAMILY_LINE_IDS || process.env.SHIELD_LINE_USER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const registered = family.members().map((m) => m.lineUserId);
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ? [...new Set([...registered, ...ids])] : [];
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
function familyProgressMessage(type, { minutes, ai_replies, intel = [] } = {}) {
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
    const types = new Set(intel.map((f) => f.type));
    const meeting = types.has("visit") || (types.has("datetime") && types.has("place"));
    return [
      "【戦国シールド】見守っていた電話が終わりました" + (parts.length ? `(${parts.join("・")})` : ""),
      ...(intel.length
        ? ["", "相手が言っていたこと:", ...intel.map((f) => `・${f.label}: ${f.value}`), ""]
        : []),
      meeting
        ? "相手が、会う日時・場所や家に来る話をしていました。本人が110番できていないようなら、代わりに110番してください。"
        : "本人に電話をかけて、お金やカードを渡す約束をしていないか、やさしく聞いてあげてください。",
      ...(types.has("account") || types.has("bank")
        ? ["相手が言った口座は、110番か #9110 で伝えてください。本人が振り込んでしまっていたら、振り込んだ銀行にも電話して口座を止めてもらってください。"]
        : []),
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

// 相手が振込先の口座を言った瞬間に、家族へ知らせる(口座を早く止めてもらうため)。
// 口座番号は相手(詐欺の疑いがある側)のもので、登録済みの家族にだけ送る。
function familyAccountMessage({ bank, account, phone } = {}) {
  return [
    "【戦国シールド・急ぎ】見守り中の電話で、相手が振込先の口座を言いました",
    "",
    ...(bank ? [`金融機関: ${bank}`] : []),
    ...(account ? [`口座番号: ${account}`] : []),
    ...(phone ? [`相手が言った電話番号: ${phone}`] : []),
    "",
    "詐欺グループの口座の可能性があります。110番(急がないときは #9110)で、この口座のことを伝えてください。",
    "もし本人が振り込んでしまっていたら、振り込んだ銀行にもすぐ電話して「詐欺にあったので、相手の口座を止めてください」と伝えてください。",
    "※音声の聞き取りなので、番号がまちがっている場合があります。SNSなどには書き込まないでください。",
  ].join("\n");
}

async function notifyFamilyAccount(info) {
  const targets = familyTargets();
  if (!targets.length || !(info && (info.account || info.bank))) return false;
  const text = familyAccountMessage(info);
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
  familyAccountMessage,
  notifyFamilyAccount,
};
