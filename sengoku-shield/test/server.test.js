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
delete process.env.TYPESAFE_API_KEY;
delete process.env.SHIELD_SKIP_SIGNATURE;
process.env.SHIELD_APP_TOKEN = "app-secret";

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
  assert.strictEqual(call.verdict.level, "high");
  assert.strictEqual(call.history.filter((h) => h.role === "caller").length, 2);
});

test("スマホ連動: 合言葉が無いと使えず、あれば判定とAI応対が返る", async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body, token = "app-secret") =>
    fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const page = await fetch(`${base}/app`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /AIに応対を代わる/);

  assert.strictEqual((await call("/api/judge", { utterance: "ATM" }, "wrong")).status, 401);
  assert.strictEqual((await call("/api/judge", {})).status, 400);

  const judged = await (await call("/api/judge", {
    utterance: "暗証番号を教えてください",
    recent: ["警察です。あなたの口座が犯罪に使われています"],
  })).json();
  assert.strictEqual(judged.risk_level, "HIGH");
  assert.strictEqual(judged.suggested_action, "TRIGGER_STEALTH_AI_SWITCH");

  const reply = await (await call("/api/decoy", { history: [{ role: "caller", text: "還付金があります" }] })).json();
  assert.strictEqual(typeof reply.text, "string");
  assert.strictEqual((await call("/api/decoy", { history: [] })).status, 400);
});

test("見守り中に「疑い:高」になったら、1通話につき1回だけ家族のLINEに知らせる", async (t) => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
  process.env.SHIELD_FAMILY_LINE_IDS = "Ufamily1,Ufamily2";
  t.after(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.SHIELD_FAMILY_LINE_IDS;
  });
  const pushed = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.line.me/")) {
      pushed.push(JSON.parse(opts.body));
      return new Response("{}", { status: 200 });
    }
    return orig(url, opts);
  };
  t.after(() => (global.fetch = orig));

  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const judge = async (utterance, session_id) =>
    (await orig(`${base}/api/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-secret" },
      body: JSON.stringify({ utterance, session_id }),
    })).json();

  const safe = await judge("宅配便です。お届け日時の確認です", "session-aaaa-1");
  assert.strictEqual(safe.family_notice, "none");
  const first = await judge("還付金があるので今日中にATMへ行って、電話番号090-1234-5678に", "session-aaaa-1");
  assert.strictEqual(first.family_notice, "sent");
  const again = await judge("キャッシュカードと暗証番号を用意して。還付金のATM手続きです", "session-aaaa-1");
  assert.strictEqual(again.family_notice, "already");
  await new Promise((r) => setTimeout(r, 50));

  assert.deepStrictEqual(pushed.map((p) => p.to).sort(), ["Ufamily1", "Ufamily2"]);
  const text = pushed[0].messages[0].text;
  assert.match(text, /詐欺の疑いが「高」/);
  assert.match(text, /#9110/);
  assert.doesNotMatch(text, /1234-5678/); // 番号は伏せる
});
