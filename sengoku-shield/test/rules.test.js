const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { validateProposal, BENIGN_SAMPLES } = require("../lib/rules");
const { score, CUSTOM_PATTERNS_PATH } = require("../lib/detector");

const good = {
  id: "fake_delivery_fee",
  label: "荷物の追加料金を口実にした支払い要求",
  weight: 3,
  source: "(荷物|お届け物).{0,10}(追加料金|関税|保管料).{0,10}(払|支払|振込)",
  flags: "",
  examples: ["お荷物の関税をお支払いください", "荷物の保管料を今日振込してください"],
  counter_examples: ["お荷物のお届け日時を確認させてください", "追加料金はかかりません"],
  reason: "テスト",
};

test("まともな提案は通る", () => {
  assert.strictEqual(validateProposal(good).ok, true);
});

test("例文に当たらない・普通の電話に当たる・危ない正規表現は落とす", () => {
  assert.strictEqual(validateProposal({ ...good, examples: ["全然関係ない文", "別の文"] }).ok, false);
  assert.strictEqual(validateProposal({ ...good, source: "お荷物|日時" }).ok, false);
  assert.strictEqual(validateProposal({ ...good, source: "(あ+)+い" }).ok, false);
  assert.strictEqual(validateProposal({ ...good, source: "(荷物)\\1" }).ok, false);
  assert.strictEqual(validateProposal({ ...good, source: "[" }).ok, false);
  assert.strictEqual(validateProposal(good, ["fake_delivery_fee"]).ok, false);
});

test("組み込みルールだけで、普通の電話の例文が「疑い:中」以上にならない", () => {
  for (const b of BENIGN_SAMPLES) assert.ok(["none", "low"].includes(score([b]).level), b);
});

test("承認済みの追加ルール(patterns.custom.json)はすべて検証に通る", () => {
  const custom = JSON.parse(fs.readFileSync(CUSTOM_PATTERNS_PATH, "utf-8"));
  for (const r of custom) {
    const result = validateProposal(r);
    assert.ok(result.ok, `${r.id}: ${(result.reasons || []).join(", ")}`);
  }
});

test("evolve.js: 提案は approve するまで反映されない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shield-evolve-"));
  const customPath = path.join(dir, "patterns.custom.json");
  fs.writeFileSync(customPath, "[]");
  fs.mkdirSync(path.join(dir, "proposals"));
  fs.writeFileSync(path.join(dir, "proposals", "pending.json"), JSON.stringify([good, { ...good, id: "other_rule" }]));
  const auditPath = path.join(dir, "audit-log.jsonl");
  const env = {
    ...process.env,
    SHIELD_DATA_DIR: dir,
    SHIELD_CUSTOM_PATTERNS: customPath,
    SHIELD_AUDIT_LOG: auditPath,
    SHIELD_EVIDENCE_DIR: path.join(dir, "evidence"),
    SHIELD_OPERATOR: "テスト担当",
  };
  const run = (...args) => execFileSync("node", [path.join(__dirname, "..", "evolve.js"), ...args], { env }).toString();

  assert.match(run("list"), /fake_delivery_fee/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(customPath, "utf-8")), []);

  run("approve", "fake_delivery_fee");
  run("reject", "other_rule");
  const custom = JSON.parse(fs.readFileSync(customPath, "utf-8"));
  assert.deepStrictEqual(custom.map((c) => c.id), ["fake_delivery_fee"]);
  assert.match(run("list"), /未承認の提案はありません/);

  // 承認・却下が監査ログに残り、ハッシュのつながりも正しい
  const entries = fs.readFileSync(auditPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepStrictEqual(entries.map((e) => e.action), ["rule.approved", "rule.rejected"]);
  assert.strictEqual(entries[0].actor, "テスト担当");
  assert.strictEqual(entries[0].data.benchmarkAfter.falsePositives, 0);
  assert.ok(fs.existsSync(path.join(dir, "evidence", "benchmark-latest.md")));

  const detected = execFileSync(
    "node",
    ["-e", 'console.log(JSON.stringify(require("./lib/detector").detect("荷物の関税を払ってください").map(m=>m.id)))'],
    { env, cwd: path.join(__dirname, "..") }
  ).toString();
  assert.deepStrictEqual(JSON.parse(detected), ["fake_delivery_fee"]);
});

