// ベンチマーク: 普通の電話の例文集(誤検知チェック)と、詐欺電話の例文集(検知率チェック)で
// 現在の検知ルールを採点し、エビデンスとして残せる形の結果を返す
//
// 例文は dev(ルール作りに使ってよい)と holdout(ルール作りに使わない、答え合わせ専用)に分けてある。
// dev だけで測ると、例文に合わせてルールを作った分だけ数字が良く見えてしまうため。
//
// 合格基準:
// - 普通の電話(dev・holdout両方): 1件でも「疑い:中」以上になったら不合格(誤検知ゼロが条件)
// - 詐欺電話(dev): 「疑い:中」以上になった割合が MIN_DETECTION_RATE 未満なら不合格(退行防止)
// - 詐欺電話(holdout): 数字を記録するだけ。これに合わせてルールを調整してはいけない

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BENIGN_PATH = path.join(ROOT, "benign-samples.json");
const SCAM_PATH = path.join(ROOT, "scam-samples.json");

// dev の詐欺電話の検知率の下限。ルールを変えてこれを下回ったら不合格(退行防止)
const MIN_DETECTION_RATE = 0.8;

const FLAGGED = new Set(["medium", "high"]);

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function loadSamples() {
  return {
    benign: JSON.parse(fs.readFileSync(BENIGN_PATH, "utf-8")),
    scam: JSON.parse(fs.readFileSync(SCAM_PATH, "utf-8")),
  };
}

function run(detector) {
  const { benign, scam } = loadSamples();

  const benignResults = benign.map((s) => {
    const r = detector.score([s.text]);
    return { id: s.id, split: s.split, category: s.category, text: s.text, level: r.level, matched: r.matches.map((m) => m.id) };
  });
  const scamResults = scam.map((s) => {
    const r = detector.score(s.utterances);
    return { id: s.id, split: s.split, category: s.category, utterances: s.utterances, level: r.level, matched: r.matches.map((m) => m.id) };
  });

  const falsePositives = benignResults.filter((r) => FLAGGED.has(r.level));
  const benignTouched = benignResults.filter((r) => r.matched.length > 0);
  const missed = scamResults.filter((r) => !FLAGGED.has(r.level));
  const rate = (split) => {
    const all = scamResults.filter((r) => r.split === split);
    const hit = all.filter((r) => FLAGGED.has(r.level)).length;
    return { total: all.length, detected: hit, rate: all.length ? hit / all.length : 0 };
  };
  const dev = rate("dev");
  const holdout = rate("holdout");
  const detectionRate = dev.rate;

  const byCategory = {};
  for (const r of scamResults.filter((x) => x.split === "dev")) {
    const c = (byCategory[r.category] ||= { total: 0, detected: 0 });
    c.total += 1;
    if (FLAGGED.has(r.level)) c.detected += 1;
  }

  const failures = [];
  if (falsePositives.length) failures.push(`普通の電話 ${falsePositives.length}件が「疑い:中」以上になった(誤検知)`);
  if (detectionRate < MIN_DETECTION_RATE) {
    failures.push(`詐欺電話(dev)の検知率 ${(detectionRate * 100).toFixed(1)}% が下限 ${MIN_DETECTION_RATE * 100}% を下回った`);
  }

  return {
    passed: failures.length === 0,
    failures,
    ranAt: new Date().toISOString(),
    inputs: {
      benign: { file: "benign-samples.json", count: benign.length, sha256: sha256File(BENIGN_PATH) },
      scam: { file: "scam-samples.json", count: scam.length, sha256: sha256File(SCAM_PATH) },
      rules: detector.PATTERNS.map((p) => ({ id: p.id, source: p.regex.source })),
      rulesSha256: crypto
        .createHash("sha256")
        .update(JSON.stringify(detector.PATTERNS.map((p) => [p.id, p.weight, p.regex.source, p.regex.flags])))
        .digest("hex"),
    },
    summary: {
      benignTotal: benignResults.length,
      falsePositives: falsePositives.length,
      benignTouched: benignTouched.length,
      scamTotal: scamResults.length,
      dev,
      holdout,
      detectionRate,
      minDetectionRate: MIN_DETECTION_RATE,
      byCategory,
    },
    falsePositives,
    benignTouched,
    missed,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function toMarkdown(result) {
  const s = result.summary;
  const lines = [
    "# 戦国シールド ベンチマーク結果",
    "",
    `- 実行日時: ${result.ranAt}`,
    `- 判定: **${result.passed ? "合格" : "不合格"}**`,
    ...result.failures.map((f) => `  - ${f}`),
    "",
    "## 概要",
    "",
    "| 項目 | 結果 |",
    "|---|---|",
    `| 普通の電話(誤検知チェック) | ${s.benignTotal}件中 誤検知 **${s.falsePositives}件**(「疑い:中」以上になった件数) |`,
    `| 普通の電話で何かのルールに触れた件数 | ${s.benignTouched}件(「疑い:低」止まり。通知・下書きの対象外) |`,
    `| 詐欺電話 dev(ルール作りに使った例文) | ${s.dev.total}件中 ${s.dev.detected}件を「疑い:中」以上で検知(**${pct(s.dev.rate)}**、下限 ${pct(s.minDetectionRate)}) |`,
    `| 詐欺電話 holdout(ルール作りに使っていない例文) | ${s.holdout.total}件中 ${s.holdout.detected}件を検知(**${pct(s.holdout.rate)}**) ← 実力に近いのはこちら |`,
    "",
    "## 手口別の検知率(dev)",
    "",
    "| 手口 | 検知 / 件数 |",
    "|---|---|",
    ...Object.entries(s.byCategory).map(([c, v]) => `| ${c} | ${v.detected} / ${v.total} |`),
    "",
    "## 見逃した詐欺電話",
    "",
    ...(result.missed.length
      ? result.missed.map((m) => `- ${m.id} [${m.split}](${m.category}、判定 ${m.level}): ${m.utterances.join(" / ")}`)
      : ["なし"]),
    "",
    "## 誤検知した普通の電話",
    "",
    ...(result.falsePositives.length
      ? result.falsePositives.map((f) => `- ${f.id} [${f.split}](${f.category}、判定 ${f.level}、${f.matched.join(",")}): ${f.text}`)
      : ["なし"]),
    "",
    "## ルールに触れたが「疑い:低」止まりの普通の電話",
    "",
    ...(result.benignTouched.length
      ? result.benignTouched.map((f) => `- ${f.id} [${f.split}](${f.category}、${f.matched.join(",")}): ${f.text}`)
      : ["なし"]),
    "",
    "## 入力データの指紋(SHA-256)",
    "",
    `- ${result.inputs.benign.file}(${result.inputs.benign.count}件): \`${result.inputs.benign.sha256}\``,
    `- ${result.inputs.scam.file}(${result.inputs.scam.count}件): \`${result.inputs.scam.sha256}\``,
    `- 検知ルール一式(${result.inputs.rules.length}件): \`${result.inputs.rulesSha256}\``,
    "",
    "## この結果の読み方(注意)",
    "",
    "- 例文はすべて開発時に作成した**模擬データ**で、実際の通話ではない。実運用の誤検知率・検知率を保証するものではない。",
    "- 正規表現は決まった言い回ししか拾えないため、言い換えられた詐欺(holdout の見逃し)に弱い。Jev(TypeSafe)の判定を組み合わせる前提。",
    "- holdout で見逃した例文を dev に移してルールを足す場合は、新しい holdout 例文を別途用意すること(同じ例文で答え合わせを繰り返すと数字が実力以上に良くなる)。",
    "- 実運用の数字を出すには、実際の通話ログ(本人同意・個人情報の伏せ字済み)で同じ採点をする必要がある。",
    "",
  ];
  return lines.join("\n");
}

// 監査ログに残す要約(例文の中身は入れず、件数と指紋だけ)
function auditSummary(result) {
  const s = result.summary;
  return {
    passed: result.passed,
    failures: result.failures,
    falsePositives: s.falsePositives,
    benignTotal: s.benignTotal,
    dev: { detected: s.dev.detected, total: s.dev.total },
    holdout: { detected: s.holdout.detected, total: s.holdout.total },
    benignSha256: result.inputs.benign.sha256,
    scamSha256: result.inputs.scam.sha256,
    rulesSha256: result.inputs.rulesSha256,
  };
}

module.exports = { run, toMarkdown, auditSummary, MIN_DETECTION_RATE };
