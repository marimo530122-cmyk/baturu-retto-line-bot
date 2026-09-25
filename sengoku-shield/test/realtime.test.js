const test = require("node:test");
const assert = require("node:assert");
delete process.env.TYPESAFE_API_KEY;
process.env.JEV_REALTIME_TIMEOUT_MS = "200";
const { judgeUtterance, categorize } = require("../lib/realtime");
const benign = require("../benign-samples.json");

test("還付金+ATMは HIGH で「AIに代わる」ボタンを出す", async () => {
  const r = await judgeUtterance({
    utterance: "期限が今日までなので、お近くのATMに行ってください。",
    recent: ["市役所の保険年金課です。医療費の還付金があります。"],
  });
  assert.strictEqual(r.risk_level, "HIGH");
  assert.strictEqual(r.trigger_alert, true);
  assert.strictEqual(r.detected_category, "TAX_REFUND");
  assert.strictEqual(r.suggested_action, "TRIGGER_AI_SWITCH_BUTTON");
  assert.ok(r.reason_short.includes("ATM"));
});

test("普通の電話の例文はすべて SAFE(通話を邪魔しない)", async () => {
  for (const b of benign) {
    const r = await judgeUtterance({ utterance: b.text });
    assert.strictEqual(r.suggested_action, "CONTINUE", b.text);
    assert.strictEqual(r.trigger_alert, false, b.text);
  }
});

test("警察を名乗っただけ・家族を名乗っただけでは IMPERSONATION にしない", () => {
  assert.strictEqual(categorize(["authority"]), "NONE");
  assert.strictEqual(categorize(["authority", "cash_demand"]), "IMPERSONATION");
  assert.strictEqual(categorize(["gift_card"]), "COERCION");
});

test("正規表現だけなら、判定は数ミリ秒以内に返る", async () => {
  const r = await judgeUtterance({ utterance: "キャッシュカードと暗証番号を封筒に入れてください" });
  assert.ok(r.latency_ms < 20, `${r.latency_ms}ms`);
});

test("Jevが時間内に返さなくても、正規表現の結果で返す", async (t) => {
  process.env.TYPESAFE_API_KEY = "dummy";
  t.after(() => delete process.env.TYPESAFE_API_KEY);
  const orig = global.fetch;
  // 5秒たっても返さないJev(実際には200msで打ち切られるはず)
  global.fetch = (url, opts) =>
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("too slow")), 5000);
      opts.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("timeout"));
      });
    });
  t.after(() => (global.fetch = orig));
  const r = await judgeUtterance({ utterance: "ATMに行ってください" }, { useJev: true });
  assert.strictEqual(r.engine, "regex");
  assert.ok(r.latency_ms < 1000, `${r.latency_ms}ms`);
  assert.strictEqual(r.risk_level, "MEDIUM");
});

test("空の発話はエラー", async () => {
  await assert.rejects(judgeUtterance({ utterance: "  " }));
});
