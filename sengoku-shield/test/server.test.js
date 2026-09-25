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

  const intelJs = await fetch(`${base}/intel.js`);
  assert.strictEqual(intelJs.status, 200);
  assert.match(await intelJs.text(), /ShieldIntel/);

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

test("AIに代わった・電話が終わったことを、種類ごとに1回だけ家族に知らせる", async (t) => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
  process.env.SHIELD_FAMILY_LINE_IDS = "Ufamily1";
  t.after(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.SHIELD_FAMILY_LINE_IDS;
  });
  const pushed = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.line.me/")) {
      pushed.push(JSON.parse(opts.body).messages[0].text);
      return new Response("{}", { status: 200 });
    }
    return orig(url, opts);
  };
  t.after(() => (global.fetch = orig));

  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const event = async (body) =>
    orig(`${base}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-secret" },
      body: JSON.stringify(body),
    });

  assert.strictEqual((await event({ session_id: "session-bbbb-1", type: "hack" })).status, 400);
  assert.strictEqual((await (await event({ session_id: "session-bbbb-1", type: "handoff" })).json()).family_notice, "sent");
  assert.strictEqual((await (await event({ session_id: "session-bbbb-1", type: "handoff" })).json()).family_notice, "already");
  assert.strictEqual(
    (await (await event({
      session_id: "session-bbbb-1",
      type: "ended",
      minutes: 7,
      ai_replies: 12,
      intel: [
        { type: "datetime", value: "明日の午後3時" },
        { type: "place", value: "新宿駅の東口改札" },
        { type: "account", value: "1234567" }, // 相手の口座は家族に送り、警察・銀行に伝えてもらう
      ],
    })).json()).family_notice,
    "sent"
  );
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(pushed.length, 2);
  assert.match(pushed[0], /AIに代わってもらう/);
  assert.match(pushed[1], /約7分・AIの返事 12回/);
  assert.match(pushed[1], /日時: 明日の午後3時/);
  assert.match(pushed[1], /代わりに110番/);
  assert.match(pushed[1], /口座番号: 1234567/);
  assert.match(pushed[1], /口座を止めてもらってください/);
  for (const text of pushed) assert.doesNotMatch(text, /中継|通報しました|警察に(送|伝え)/);
});

test("見守り画面から招待番号を出し、LINEのWebhook(署名つき)で家族が登録される", async (t) => {
  process.env.LINE_CHANNEL_SECRET = "line-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
  t.after(() => {
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });
  const replies = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("/profile/")) return Response.json({ displayName: "長女" });
    if (String(url).startsWith("https://api.line.me/")) {
      replies.push(JSON.parse(opts.body));
      return new Response("{}", { status: 200 });
    }
    return orig(url, opts);
  };
  t.after(() => (global.fetch = orig));

  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, body = {}) =>
    (await orig(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-secret" },
      body: JSON.stringify(body),
    })).json();

  const { code } = await api("/api/family/invite");
  const webhookBody = JSON.stringify({
    events: [{ type: "message", replyToken: "rt", source: { type: "user", userId: "Udaughter" }, message: { type: "text", text: code } }],
  });
  const bad = await orig(`${base}/line/webhook`, { method: "POST", headers: { "X-Line-Signature": "bad" }, body: webhookBody });
  assert.strictEqual(bad.status, 401);

  const sig = crypto.createHmac("sha256", "line-secret").update(webhookBody).digest("base64");
  const ok = await orig(`${base}/line/webhook`, { method: "POST", headers: { "X-Line-Signature": sig }, body: webhookBody });
  assert.strictEqual(ok.status, 200);
  await new Promise((r) => setTimeout(r, 50));

  const list = await api("/api/family/list");
  assert.deepStrictEqual(list.members.map((m) => m.name), ["長女"]);
  assert.match(replies[0].messages[0].text, /登録しました/);

  const removed = await api("/api/family/remove", { id: list.members[0].id });
  assert.strictEqual(removed.removed, true);
  assert.deepStrictEqual(removed.members, []);
});

test("相手が振込先の口座を言ったら、電話の途中でもすぐ家族に口座を送る(口座ごとに1回)", async (t) => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
  process.env.SHIELD_FAMILY_LINE_IDS = "Ufamily1";
  t.after(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.SHIELD_FAMILY_LINE_IDS;
  });
  const pushed = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.line.me/")) {
      pushed.push(JSON.parse(opts.body).messages[0].text);
      return new Response("{}", { status: 200 });
    }
    return orig(url, opts);
  };
  t.after(() => (global.fetch = orig));

  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const judge = async (utterance, recent = []) =>
    (await orig(`${base}/api/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-secret" },
      body: JSON.stringify({ utterance, recent, session_id: "session-cccc-1" }),
    })).json();

  // 普通の電話(お店の支払い案内など)では口座を送らない
  const benign = await judge("お支払いは、みずほ銀行新宿支店、口座番号は7654321でお願いします");
  assert.strictEqual(benign.account_notice, "none");

  const first = await judge("みずほ銀行新宿支店、口座番号は1234567です", ["還付金があります。今日中にATMで手続きを"]);
  assert.strictEqual(first.account_notice, "sent");
  const again = await judge("口座番号は1234567ですよ", ["還付金があります。今日中にATMで手続きを"]);
  assert.strictEqual(again.account_notice, "none");
  await new Promise((r) => setTimeout(r, 50));

  const accountMsgs = pushed.filter((p) => p.includes("振込先の口座を言いました"));
  assert.strictEqual(accountMsgs.length, 1);
  assert.match(accountMsgs[0], /金融機関: みずほ銀行新宿支店/);
  assert.match(accountMsgs[0], /口座番号: 1234567/);
  assert.match(accountMsgs[0], /SNSなどには書き込まないでください/);
});
