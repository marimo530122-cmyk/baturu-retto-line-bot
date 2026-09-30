// デモページ(demo/index.html)を、今の検知ルール(lib/detector.js)から作り直す
//   node demo/build.js
// ルールを変えたら実行すること(テストでデモとルールの一致を確認している)

const fs = require("fs");
const path = require("path");
const detector = require("../lib/detector");
const benchmark = require("../lib/benchmark");
const { BUILTIN_PATTERNS, compileRules, CUSTOM_PATTERNS_PATH } = detector;

function demoPatterns() {
  let custom = [];
  try {
    custom = compileRules(JSON.parse(fs.readFileSync(CUSTOM_PATTERNS_PATH, "utf-8")));
  } catch {}
  return [...BUILTIN_PATTERNS, ...custom].map((p) => ({
    id: p.id,
    label: p.label,
    weight: p.weight,
    source: p.regex.source,
    flags: p.regex.flags,
  }));
}

function build() {
  const template = fs.readFileSync(path.join(__dirname, "template.html"), "utf-8");
  // </script> が紛れ込まないように < をエスケープして埋め込む
  const json = JSON.stringify(demoPatterns()).replace(/</g, "\\u003c");
  // 画面の「この試作品について」の数字は、その場でベンチマークを回して埋める
  const s = benchmark.run(detector).summary;
  // 手がかりの抜き出し(lib/intel.js)もそのまま埋め込む。</script> が紛れ込まないようにする
  const intelJs = fs.readFileSync(path.join(__dirname, "..", "lib", "intel.js"), "utf-8").replace(/<\/script/gi, "<\\/script");
  return template
    .replace("__PATTERNS__", json)
    .replace("__INTEL_JS__", () => intelJs)
    .replace("__FP__", s.falsePositives)
    .replace("__BENIGN__", s.benignTotal)
    .replace("__DEV_HIT__", s.dev.detected)
    .replace("__DEV__", s.dev.total)
    .replace("__HOLD_HIT__", s.holdout.detected)
    .replace("__HOLD__", s.holdout.total);
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, "index.html"), build());
  console.log("demo/index.html を作りました");
}

module.exports = { build, demoPatterns };
