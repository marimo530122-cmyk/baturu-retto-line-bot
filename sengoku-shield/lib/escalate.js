// 急ぎの知らせ: 詐欺の疑いがある電話で、相手が「振込先の口座」「会う日時と場所」「家に来る話」を
// 言った瞬間に、電話が終わるのを待たずに家族へ知らせる。見守り画面(/api/judge)とTwilioの自動応答の両方で使う。
//
// - 口座: 家族のLINEに口座を送る(口座ごとに1回)
// - 口座・会う日時と場所・家に来る話のどれか: 家族に自動音声の電話をかける(1通話につき1回)

const intel = require("./intel");
const { notifyFamilyAccount, familyTargets } = require("./notify");
const familycall = require("./familycall");

const done = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

function once(key) {
  const now = Date.now();
  for (const [k, at] of done) if (now - at > TTL_MS) done.delete(k);
  if (done.has(key)) return false;
  done.set(key, now);
  return true;
}

// lines: 相手の発言(この通話の直近分)。suspicious: 詐欺の疑いが中以上か
function onCallerSpeech({ sessionId, lines, suspicious }) {
  const result = { account_notice: "none", call_notice: "none" };
  if (!sessionId || !suspicious) return result;

  const found = intel.extract(lines);
  const first = (type) => found.find((f) => f.type === type)?.value;
  const info = {
    account: first("account"),
    bank: first("bank"),
    phone: first("phone"),
    datetime: first("datetime"),
    place: first("place"),
    visit: first("visit"),
    amount: first("amount"),
  };

  // 知らせる先がないときは「送った」ことにしない(画面に「家族に知らせました」と出さないため)
  if (info.account && familyTargets().length && once(`${sessionId}:account:${info.account}`)) {
    result.account_notice = "sent";
    notifyFamilyAccount(info).catch((err) => console.error("[escalate]", err.message));
  }

  const urgent = Boolean(info.account || info.visit || (info.datetime && info.place));
  if (urgent && familycall.ready() && familycall.familyPhones().length && once(`${sessionId}:call`)) {
    result.call_notice = "calling";
    familycall
      .callFamily(info)
      .then((n) => n && console.log(`[escalate] 家族${n}人に自動電話をかけました`))
      .catch((err) => console.error("[escalate]", err.message));
  }
  return result;
}

module.exports = { onCallerSpeech };
