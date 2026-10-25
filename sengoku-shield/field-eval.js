// 実際の電話の文字起こしで、追加の検知部品(文字のゆれをそろえる・手口の段階の連鎖)の効果を測る
//
//   node field-eval.js <ファイルやフォルダ> ...        … まとめの数字だけを出す
//   node field-eval.js --details <ファイル> ...       … 1件ごとに、当たったルールの id も出す(発言の中身は出さない)
//
// 読めるもの:
// - 警察の録音の文字起こし(transcribe-police-audio ワークフローの出力。「## 番号. ファイル名」ごとに1件、
//   「- [分:秒] 発言」の行を発言として読む。GitHub のログの時刻の前置きが付いていてもよい)
// - 鮮刻シールドの通話ログ(data/calls/*.json)。相手(caller)の発言だけを使う
// - ふつうのテキスト(1行1発言、空行で区切ると別の電話)
//
// 比べるのは「前」(元の文だけで調べる・段階の連鎖なし)と「後」(今の判定)。
// 結果を書き出すファイルは作らない(通話の中身をリポジトリに残さないため)。
// ここで見た見逃しに合わせてルールを直さないこと(holdout と同じで、数字が実力以上に良く見えるため)。

const fs = require("fs");
const path = require("path");
const detector = require("./lib/detector");
const { combine } = require("./lib/jev");

const FLAGGED = new Set(["medium", "high"]);
const ORDER = ["none", "low", "medium", "high"];

// GitHub のログの行頭の時刻(2026-10-02T08:33:03.9746708Z )と、色の制御文字を取る
function cleanLine(line) {
  return line.replace(/\u001b\[[0-9;]*m/g, "").replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "");
}

// 1つのファイルから、電話ごとの発言のまとまりを取り出す
function parseFile(file) {
  const raw = fs.readFileSync(file, "utf-8");
  if (file.endsWith(".json")) {
    const call = JSON.parse(raw);
    const lines = (call.history || []).filter((h) => h.role === "caller").map((h) => String(h.text || ""));
    return lines.length ? [{ name: path.basename(file), utterances: lines }] : [];
  }
  const lines = raw.split(/\r?\n/).map(cleanLine);
  const calls = [];
  let current = null;
  const flush = () => {
    if (current && current.utterances.length) calls.push(current);
    current = null;
  };
  const isTranscript = lines.some((l) => /^- \[\d+:\d{2}\] /.test(l));
  for (const line of lines) {
    if (isTranscript) {
      const head = line.match(/^## (\d+)\. (.+)$/);
      if (head) {
        flush();
        current = { name: head[2].trim(), utterances: [] };
        continue;
      }
      const said = line.match(/^- \[\d+:\d{2}\] (.+)$/);
      if (said && current) current.utterances.push(said[1].trim());
    } else if (!line.trim()) {
      flush();
    } else {
      current ??= { name: `${path.basename(file)}#${calls.length + 1}`, utterances: [] };
      current.utterances.push(line.trim());
    }
  }
  flush();
  return calls;
}

function listFiles(inputs) {
  return inputs.flatMap((p) =>
    fs.statSync(p).isDirectory()
      ? fs.readdirSync(p).filter((f) => /\.(txt|log|md|json)$/.test(f)).map((f) => path.join(p, f))
      : [p]
  );
}

// 1件の電話を「前」と「後」で判定する
function evaluate(call, { before, after }) {
  const old = before.score(call.utterances);
  const now = after.score(call.utterances);
  const verdict = combine(now, null);
  const oldIds = new Set(old.matches.map((m) => m.id));
  return {
    name: call.name,
    utterances: call.utterances.length,
    before: old.level,
    after: verdict.level,
    addedByNormalize: now.matches.filter((m) => !oldIds.has(m.id)).map((m) => m.id),
    chain: verdict.chain ?? null,
    matched: now.matches.map((m) => m.id),
  };
}

function summarize(results) {
  const count = (fn) => results.filter(fn).length;
  const levels = (key) => Object.fromEntries(ORDER.map((l) => [l, count((r) => r[key] === l)]));
  const ruleHits = {};
  for (const r of results) for (const id of r.addedByNormalize) ruleHits[id] = (ruleHits[id] || 0) + 1;
  return {
    calls: results.length,
    utterances: results.reduce((n, r) => n + r.utterances, 0),
    before: levels("before"),
    after: levels("after"),
    flaggedBefore: count((r) => FLAGGED.has(r.before)),
    flaggedAfter: count((r) => FLAGGED.has(r.after)),
    raisedByNormalize: count((r) => r.addedByNormalize.length > 0),
    normalizeRuleHits: ruleHits,
    raisedToHighByChain: count((r) => r.chain !== null),
    levelUp: count((r) => ORDER.indexOf(r.after) > ORDER.indexOf(r.before)),
    levelDown: count((r) => ORDER.indexOf(r.after) < ORDER.indexOf(r.before)),
  };
}

function toMarkdown(s, results, { details = false } = {}) {
  const pct = (n) => (s.calls ? `${((n / s.calls) * 100).toFixed(1)}%` : "-");
  const lines = [
    "# 鮮刻シールド 実データでの効果測定",
    "",
    `- 電話の数: ${s.calls}件(発言 ${s.utterances}行)`,
    "",
    "| | 前(元の文だけ・連鎖なし) | 後(今の判定) |",
    "|---|---|---|",
    ...ORDER.slice().reverse().map((l) => `| ${l} | ${s.before[l]} | ${s.after[l]} |`),
    `| **中以上(警告が出る)** | **${s.flaggedBefore}(${pct(s.flaggedBefore)})** | **${s.flaggedAfter}(${pct(s.flaggedAfter)})** |`,
    "",
    `- 文字のゆれをそろえて、新しく当たったルールがあった電話: ${s.raisedByNormalize}件 ${JSON.stringify(s.normalizeRuleHits)}`,
    `- 手口の段階がそろって「高」に上げた電話: ${s.raisedToHighByChain}件`,
    `- 判定が上がった電話: ${s.levelUp}件 / 下がった電話: ${s.levelDown}件(下がることはない作りなので、0件のはず)`,
  ];
  if (details) {
    lines.push("", "| 電話 | 発言数 | 前 | 後 | そろえて当たった | 段階の連鎖 | 当たったルール |", "|---|---|---|---|---|---|---|");
    for (const r of results) {
      lines.push(`| ${r.name} | ${r.utterances} | ${r.before} | ${r.after} | ${r.addedByNormalize.join(", ")} | ${r.chain ?? ""} | ${r.matched.join(", ")} |`);
    }
  }
  return lines.join("\n") + "\n";
}

function main(argv) {
  const details = argv.includes("--details");
  const inputs = argv.filter((a) => !a.startsWith("--"));
  if (!inputs.length) {
    console.error("使い方: node field-eval.js [--details] <ファイルやフォルダ> ...");
    process.exit(2);
  }
  const before = detector.createDetector(detector.PATTERNS, { normalize: false });
  const after = detector.createDetector(detector.PATTERNS);
  // 同じ録音が何度も文字起こしされていても、1回だけ数える
  const seen = new Set();
  const calls = listFiles(inputs).flatMap(parseFile).filter((c) => !seen.has(c.name) && seen.add(c.name));
  const results = calls.map((c) => evaluate(c, { before, after }));
  process.stdout.write(toMarkdown(summarize(results), results, { details }));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseFile, evaluate, summarize, toMarkdown };
