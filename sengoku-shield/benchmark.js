// ベンチマークを実行し、結果をエビデンスとして evidence/ に書き出す
//   node benchmark.js           … 実行して evidence/benchmark-latest.{md,json} を更新
//   node benchmark.js --check   … 不合格なら終了コード1(CI用)
//   node benchmark.js --record  … 結果を監査ログにも記録する
//   --out <dir>                 … 書き出し先を変える(CIでは成果物用のフォルダに出す)

const fs = require("fs");
const path = require("path");
const detector = require("./lib/detector");
const benchmark = require("./lib/benchmark");
const audit = require("./lib/audit");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : process.env.SHIELD_EVIDENCE_DIR || path.join(__dirname, "evidence");

const result = benchmark.run(detector);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "benchmark-latest.json"), JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "benchmark-latest.md"), benchmark.toMarkdown(result));

const s = result.summary;
console.log(`判定: ${result.passed ? "合格" : "不合格"}`);
console.log(`普通の電話: ${s.benignTotal}件中 誤検知 ${s.falsePositives}件`);
console.log(`詐欺電話 dev: ${s.dev.detected}/${s.dev.total}(${(s.dev.rate * 100).toFixed(1)}%)`);
console.log(`詐欺電話 holdout: ${s.holdout.detected}/${s.holdout.total}(${(s.holdout.rate * 100).toFixed(1)}%)`);
for (const f of result.failures) console.log(`  × ${f}`);
console.log(`エビデンス: ${path.join(outDir, "benchmark-latest.md")}`);

if (args.includes("--record")) {
  const entry = audit.append("benchmark.run", benchmark.auditSummary(result));
  console.log(`監査ログに記録: #${entry.seq}`);
}
if (args.includes("--check") && !result.passed) process.exit(1);
