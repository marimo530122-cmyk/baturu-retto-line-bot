const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SHIELD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-"));
process.env.SHIELD_APP_TOKEN = "app-secret";
process.env.SHIELD_RATE_PER_MIN = "30";
process.env.SHIELD_AUTH_FAIL_LIMIT = "3";
process.env.SHIELD_ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/1/test";
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TYPESAFE_API_KEY;

const guard = require("../lib/guard");
const { server } = require("../server");

function captureWebhook(t) {
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://discord.com/")) {
      sent.push(JSON.parse(opts.body));
      return new Response(null, { status: 204 });
    }
    return realFetch(url, opts);
  };
  t.after(() => (global.fetch = realFetch));
  return sent;
}

test("合言葉を続けて間違えた相手は締め出され、Discordに知らせが届く", async (t) => {
  guard._reset();
  const sent = captureWebhook(t);
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const judge = (token) =>
    fetch(`${base}/api/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ utterance: "もしもし" }),
    });

  for (let i = 0; i < 3; i++) assert.strictEqual((await judge("wrong")).status, 401);
  // 正しい合言葉でも、締め出し中は通さない(総当たりで当たっても使えない)
  const locked = await judge("app-secret");
  assert.strictEqual(locked.status, 429);
  assert.ok(locked.headers.get("retry-after"));
  assert.strictEqual(locked.headers.get("x-content-type-options"), "nosniff");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => /締め出しました/.test(m.content)));

  // /health は見張りの対象外(Render の死活確認を止めない)
  assert.strictEqual((await fetch(`${base}/health`)).status, 200);
});

test("1分間の上限を超えた連打は 429 で止め、知らせは1回だけ", async (t) => {
  guard._reset();
  const sent = captureWebhook(t);
  const ip = "203.0.113.9";
  const results = [];
  for (let i = 0; i < 35; i++) results.push(guard.check(ip));
  assert.strictEqual(results.filter((r) => r === null).length, 30);
  assert.strictEqual(results.filter((r) => r === "rate").length, 5);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(sent.filter((m) => /連打/.test(m.content)).length, 1);
});

test("5xx が続いたら知らせる", async (t) => {
  guard._reset();
  const sent = captureWebhook(t);
  for (let i = 0; i < 5; i++) guard.record("198.51.100.1", 500, "/api/judge");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => /サーバーエラー/.test(m.content)));
});
