// 見守り家族の名簿(誰に知らせるか)
//
// 登録の流れ:
// 1. 本人の見守り画面で「家族を登録する」を押すと、6桁の招待番号が出る(30分で無効)
// 2. 家族が戦国シールドのLINE公式アカウントを友だち追加して、その番号を送る → 登録
// 3. 続けて電話番号を送ると、自動電話(詐欺の疑いが高いとき)の連絡先にもなる
//
// 招待番号を知っている人しか登録できない。総当たりを防ぐため、1人5回まちがえたら止める。
// 名簿は data/family.json(Git に入れない)に保存する。

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const FAMILY_PATH = () => path.join(store.DATA_DIR, "family.json");
const INVITE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_MEMBERS = 10;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FAMILY_PATH(), "utf-8"));
  } catch {
    return { members: [], invite: null, attempts: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FAMILY_PATH()), { recursive: true });
  fs.writeFileSync(FAMILY_PATH(), JSON.stringify(data, null, 2));
}

// 新しい招待番号を出す(前の番号は無効になる)
function createInvite(now = Date.now()) {
  const data = load();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  data.invite = { code, expiresAt: now + INVITE_TTL_MS };
  data.attempts = {};
  save(data);
  return { code, expiresAt: new Date(data.invite.expiresAt).toISOString() };
}

// LINEで送られてきた招待番号を確かめて登録する
// 戻り値: { ok: true, member } / { ok: false, reason: "expired" | "wrong" | "locked" | "full" }
function redeem(lineUserId, code, name = "", now = Date.now()) {
  const data = load();
  data.attempts = data.attempts || {};
  if ((data.attempts[lineUserId] || 0) >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const existing = data.members.find((m) => m.lineUserId === lineUserId);
  if (existing) return { ok: true, member: existing, already: true };

  if (!data.invite || now > data.invite.expiresAt) return { ok: false, reason: "expired" };
  const a = Buffer.from(String(code));
  const b = Buffer.from(data.invite.code);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    data.attempts[lineUserId] = (data.attempts[lineUserId] || 0) + 1;
    save(data);
    return { ok: false, reason: data.attempts[lineUserId] >= MAX_ATTEMPTS ? "locked" : "wrong" };
  }
  if (data.members.length >= MAX_MEMBERS) return { ok: false, reason: "full" };

  const member = {
    id: crypto.randomBytes(6).toString("hex"),
    lineUserId,
    name: String(name || "").slice(0, 30),
    phone: null,
    registeredAt: new Date(now).toISOString(),
  };
  data.members.push(member);
  save(data);
  return { ok: true, member };
}

// 日本の電話番号として受け付ける形(090-1234-5678 / 0312345678 / +819012345678)を E.164 にそろえる
function normalizePhone(text) {
  const digits = String(text || "").replace(/[\s\-‐ー−()（）]/g, "");
  if (/^\+81\d{9,10}$/.test(digits)) return digits;
  if (/^0\d{9,10}$/.test(digits)) return `+81${digits.slice(1)}`;
  return null;
}

function setPhone(lineUserId, phone) {
  const data = load();
  const m = data.members.find((x) => x.lineUserId === lineUserId);
  if (!m) return null;
  m.phone = phone;
  save(data);
  return m;
}

function removeByLineUser(lineUserId) {
  const data = load();
  const before = data.members.length;
  data.members = data.members.filter((m) => m.lineUserId !== lineUserId);
  save(data);
  return data.members.length < before;
}

function removeById(id) {
  const data = load();
  const before = data.members.length;
  data.members = data.members.filter((m) => m.id !== id);
  save(data);
  return data.members.length < before;
}

function isMember(lineUserId) {
  return load().members.some((m) => m.lineUserId === lineUserId);
}

function members() {
  return load().members;
}

// 見守り画面に出す一覧(LINEのIDや電話番号そのものは出さない)
function publicList() {
  return members().map((m) => ({
    id: m.id,
    name: m.name || "(名前なし)",
    hasPhone: Boolean(m.phone),
    phoneTail: m.phone ? m.phone.slice(-4) : null,
    registeredAt: m.registeredAt,
  }));
}

module.exports = {
  createInvite,
  redeem,
  normalizePhone,
  setPhone,
  removeByLineUser,
  removeById,
  isMember,
  members,
  publicList,
  MAX_ATTEMPTS,
  INVITE_TTL_MS,
};
