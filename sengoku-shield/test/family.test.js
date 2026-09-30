const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SHIELD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-family-"));
process.env.LINE_CHANNEL_SECRET = "line-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
delete process.env.SHIELD_FAMILY_LINE_IDS;
delete process.env.SHIELD_LINE_USER_ID;

const family = require("../lib/family");
const line = require("../lib/line");
const { familyTargets } = require("../lib/notify");

// LINE の API は呼ばずに、送ろうとした内容だけ記録する
const sent = [];
global.fetch = async (url, opts) => {
  if (String(url).includes("/profile/")) return Response.json({ displayName: "長男" });
  sent.push({ url: String(url), body: JSON.parse(opts.body) });
  return new Response("{}", { status: 200 });
};

const msg = (userId, text) => ({
  type: "message",
  replyToken: "r",
  source: { type: "user", userId },
  message: { type: "text", text },
});

test("招待番号を送った家族だけが登録され、通知先になる", async () => {
  const { code } = family.createInvite();
  assert.match(code, /^\d{6}$/);
  assert.strictEqual(await line.handleEvent({ type: "follow", source: { type: "user", userId: "Uson" } }), line.TEXT.welcome);

  const reply = await line.handleEvent(msg("Uson", code.replace(/(\d{3})/, "$1 ")));
  assert.match(reply, /見守り家族として登録しました\(長男さん\)/);
  assert.deepStrictEqual(familyTargets(), ["Uson"]);
  assert.strictEqual(family.publicList()[0].name, "長男");
  assert.ok(!JSON.stringify(family.publicList()).includes("Uson"), "画面用の一覧にLINEのIDを出さない");
});

test("電話番号を送ると、自動電話の連絡先として登録される", async () => {
  assert.match(await line.handleEvent(msg("Uson", "090-1234-5678")), /末尾5678/);
  assert.strictEqual(family.members()[0].phone, "+819012345678");
  assert.strictEqual(family.publicList()[0].phoneTail, "5678");
  assert.strictEqual(await line.handleEvent(msg("Ustranger", "090-1111-2222")), line.TEXT.notMember);
});

test("番号ちがいが5回続いたら、その人は登録できなくなる", async () => {
  const { code } = family.createInvite();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < family.MAX_ATTEMPTS - 1; i++) {
    assert.strictEqual(await line.handleEvent(msg("Uattacker", wrong)), line.TEXT.wrong);
  }
  assert.strictEqual(await line.handleEvent(msg("Uattacker", wrong)), line.TEXT.locked);
  assert.strictEqual(await line.handleEvent(msg("Uattacker", code)), line.TEXT.locked); // 正しい番号でももう通らない
  assert.ok(!family.isMember("Uattacker"));
});

test("期限切れの招待番号では登録できない", () => {
  const { code } = family.createInvite(Date.now() - family.INVITE_TTL_MS - 1000);
  assert.deepStrictEqual(family.redeem("Ulate", code), { ok: false, reason: "expired" });
});

test("「解除」で登録を消せる", async () => {
  assert.strictEqual(await line.handleEvent(msg("Uson", "解除")), line.TEXT.unregistered);
  assert.deepStrictEqual(familyTargets(), []);
});

test("LINEの署名が正しいときだけ受け付ける", () => {
  const body = JSON.stringify({ events: [] });
  const sig = crypto.createHmac("sha256", "line-secret").update(body).digest("base64");
  assert.strictEqual(line.isValidSignature(body, sig), true);
  assert.strictEqual(line.isValidSignature(body, "bad"), false);
  assert.strictEqual(line.isValidSignature(body + " ", sig), false);
});
