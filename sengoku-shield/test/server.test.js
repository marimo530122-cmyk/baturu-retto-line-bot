const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SHIELD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-"));
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.SHIELD_PUBLIC_URL = "https://example.test";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SHIELD_SKIP_SIGNATURE;

const { server } = require("../server");
const store = require("../lib/store");

function sign(url, params) {
  const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
  return crypto.createHmac("sha1", "test-token").update(data).digest("base64");
}

async function post(base, p, params, { badSig = false } = {}) {
  const sig = badSig ? "invalid" : sign("https://example.test" + p, params);
  return fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
    body: new URLSearchParams(params),
  });
}

test("着信→会話→終了で通話ログと判定が残る", async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const bad = await post(base, "/voice/incoming", { CallSid: "CA1", From: "+819012345678" }, { badSig: true });
  assert.strictEqual(bad.status, 403);

  const r1 = await post(base, "/voice/incoming", { CallSid: "CA1", From: "+819012345678" });
  const xml1 = await r1.text();
  assert.match(xml1, /自動応答システム/);
  assert.match(xml1, /<Gather input="speech"/);

  await post(base, "/voice/turn", { CallSid: "CA1", SpeechResult: "区役所です。還付金があるのでATMに行ってください" });
  await post(base, "/voice/turn", { CallSid: "CA1", SpeechResult: "キャッシュカードと暗証番号を確認します" });
  const done = await post(base, "/voice/status", { CallSid: "CA1", CallStatus: "completed", CallDuration: "95" });
  assert.strictEqual(done.status, 204);
  await new Promise((r) => setTimeout(r, 50));

  const call = store.load("CA1");
  assert.strictEqual(call.durationSec, 95);
  assert.strictEqual(call.detection.level, "high");
  assert.strictEqual(call.history.filter((h) => h.role === "caller").length, 2);
});
