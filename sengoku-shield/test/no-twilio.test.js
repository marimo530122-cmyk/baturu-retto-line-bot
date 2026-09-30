const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Twilio を登録していない状態: 電話の受け口は閉じ、見守り画面の判定は動く
process.env.SHIELD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-"));
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.SHIELD_SKIP_SIGNATURE;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TYPESAFE_API_KEY;
process.env.SHIELD_PUBLIC_URL = "https://example.test";
process.env.SHIELD_APP_TOKEN = "app-secret";

const { server } = require("../server");

test("Twilio なしでも見守り画面は動き、/voice/* は閉じている", async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const voice = await fetch(base + "/voice/incoming", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallSid: "CA1", From: "+819012345678" }),
  });
  assert.strictEqual(voice.status, 404);

  assert.strictEqual((await fetch(base + "/app")).status, 200);
  const judged = await fetch(base + "/api/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer app-secret" },
    body: JSON.stringify({
      session_id: "no-twilio-1",
      utterance: "還付金があるので今日中にATMへ行ってください。明日三時に駅前で待っています",
    }),
  });
  assert.strictEqual(judged.status, 200);
  const body = await judged.json();
  assert.strictEqual(body.trigger_alert, true);
  // Twilio が無いので家族への自動電話はかけない(かけたことにもしない)
  assert.strictEqual(body.call_notice, "none");
});
