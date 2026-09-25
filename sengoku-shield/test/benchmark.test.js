const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const detector = require("../lib/detector");
const benchmark = require("../lib/benchmark");

const result = benchmark.run(detector);

test("普通の電話の例文が50件以上ある", () => {
  assert.ok(result.summary.benignTotal >= 50, `${result.summary.benignTotal}件`);
});

test("現在のルールでベンチマークに合格する(誤検知0件・dev検知率が下限以上)", () => {
  assert.strictEqual(result.passed, true, result.failures.join(" / "));
  assert.strictEqual(result.summary.falsePositives, 0);
});

test("例文のidは重複せず、dev と holdout の両方がある", () => {
  for (const file of ["benign-samples.json", "scam-samples.json"]) {
    const samples = JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf-8"));
    const ids = samples.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, file);
    assert.ok(samples.some((s) => s.split === "dev") && samples.some((s) => s.split === "holdout"), file);
  }
});

test("コミットされているエビデンス(evidence/)が今のルール・例文と一致している", () => {
  const saved = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "evidence", "benchmark-latest.json"), "utf-8")
  );
  const msg = "ルールか例文が変わっています。node benchmark.js を実行して evidence/ を更新してください";
  assert.strictEqual(saved.inputs.rulesSha256, result.inputs.rulesSha256, msg);
  assert.strictEqual(saved.inputs.benign.sha256, result.inputs.benign.sha256, msg);
  assert.strictEqual(saved.inputs.scam.sha256, result.inputs.scam.sha256, msg);
});
