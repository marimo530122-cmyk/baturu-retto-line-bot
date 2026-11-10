const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SHIELD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-ret-"));
const store = require("../lib/store");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-11T12:00:00Z");
const at = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();

test("30日を過ぎた通話記録だけを消す", () => {
  store.save({ callSid: "CAold", startedAt: at(31), detection: { matches: [] } });
  store.save({ callSid: "CAnew", startedAt: at(29), detection: { matches: [] } });
  store.save({ callSid: "CAedge", startedAt: at(30) + "", detection: { matches: [] } });
  const removed = store.purgeOld({ now });
  assert.strictEqual(removed, 1);
  assert.strictEqual(store.load("CAold"), null);
  assert.ok(store.load("CAnew"));
  assert.ok(store.load("CAedge"));
});

test("保存期間が0以下なら何も消さない", () => {
  store.save({ callSid: "CAkeep", startedAt: at(400), detection: { matches: [] } });
  assert.strictEqual(store.purgeOld({ now, days: 0 }), 0);
  assert.ok(store.load("CAkeep"));
});

test("開始時刻が読めないファイルは更新時刻で判断する", () => {
  store.save({ callSid: "CAbad", startedAt: "??", detection: { matches: [] } });
  const file = path.join(store.DATA_DIR, "calls", "CAbad.json");
  const old = new Date(now - 40 * DAY);
  fs.utimesSync(file, old, old);
  // CAkeep(400日前)も一緒に消えるので、件数は2
  assert.strictEqual(store.purgeOld({ now }), 2);
  assert.strictEqual(store.load("CAbad"), null);
  assert.strictEqual(store.load("CAkeep"), null);
});
