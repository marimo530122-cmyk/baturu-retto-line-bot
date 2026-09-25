const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shield-audit-")), "audit-log.jsonl");
process.env.SHIELD_AUDIT_LOG = logPath;
process.env.SHIELD_OPERATOR = "テスト担当";
const audit = require("../lib/audit");

test("追記した記録はハッシュでつながり、検証に通る", () => {
  audit.append("rule.proposed", { id: "a" });
  audit.append("rule.approved", { id: "a" });
  audit.append("rule.rejected", { id: "b", reason: "誤検知しそう" });
  const r = audit.verify();
  assert.strictEqual(r.ok, true, r.errors.join(","));
  assert.strictEqual(r.count, 3);
});

test("途中の1行を書き換えると検知する", () => {
  const entries = audit.readEntries();
  const tampered = entries.map((e) => ({ ...e, data: { ...e.data } }));
  tampered[1].data.id = "z";
  assert.strictEqual(audit.verify(tampered).ok, false);
});

test("途中の1行を消すと検知する", () => {
  const entries = audit.readEntries();
  assert.strictEqual(audit.verify([entries[0], entries[2]]).ok, false);
});

test("以前の版と比べて、末尾を消したり過去を書き換えたりしたら検知する", () => {
  const entries = audit.readEntries();
  assert.strictEqual(audit.verify(entries, entries.slice(0, 2)).ok, true);
  assert.strictEqual(audit.verify(entries.slice(0, 2), entries).ok, false);
});
