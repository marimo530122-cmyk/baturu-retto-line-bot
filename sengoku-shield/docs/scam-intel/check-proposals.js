// ルール案の機械チェック(evolve approve と同じ手順を、反映せずに行う)
//   node docs/scam-intel/check-proposals.js . docs/scam-intel/<件>.proposals.json docs/scam-intel/<件>.probes.json
// 案ごとの検証(例文・当たってはいけない例・普通の電話93件・遅さ)、ベンチマークの前後、試しの文の前後を出す。
const path = require("path");
const root = path.resolve(process.argv[2]);
const { validateProposal, builtinIds } = require(root + "/lib/rules");
const { BUILTIN_PATTERNS, createDetector, compileRules } = require(root + "/lib/detector");
const benchmark = require(root + "/lib/benchmark");
const proposals = require(path.resolve(process.argv[3]));
const custom = require(root + "/patterns.custom.json");
const taken = [...builtinIds(), ...custom.map((c) => c.id)];
const ok = [];
for (const p of proposals) {
  const r = validateProposal(p, taken);
  console.log(`■ ${p.id}: ${r.ok ? "検証OK" : "検証NG " + r.reasons.join(" / ")}`);
  if (r.ok) ok.push(r.rule);
}
const before = createDetector([...BUILTIN_PATTERNS, ...compileRules(custom)]);
const after = createDetector([...BUILTIN_PATTERNS, ...compileRules([...custom, ...ok])]);
const sb = benchmark.auditSummary(benchmark.run(before));
const sa = benchmark.auditSummary(benchmark.run(after));
console.log("ベンチマーク 前:", JSON.stringify(sb));
console.log("ベンチマーク 後:", JSON.stringify(sa));
const probes = require(path.resolve(process.argv[4]));
console.log("--- 試しの文(合成) 前 → 後 ---");
for (const [name, lines] of Object.entries(probes)) {
  const a = before.score(lines), b = after.score(lines);
  const mark = a.level === b.level ? "  " : "→ ";
  console.log(`${mark}${name}: ${a.level}(${a.score}) → ${b.level}(${b.score}) ${b.matches.map((m) => m.id).join(",")}`);
}
