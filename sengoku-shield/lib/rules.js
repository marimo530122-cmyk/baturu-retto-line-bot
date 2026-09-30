// AIが提案した検知ルールを、人間に見せる前に機械的にふるい落とす
//
// 自己進化といっても「AIが勝手に書き換えて本番に反映」はしない。
// ここで落ちなかったものだけを提案として保存し、反映は人間が evolve.js approve で行う。

const fs = require("fs");
const path = require("path");
const { BUILTIN_PATTERNS } = require("./detector");

// AIの提案ルールは、普通の電話の例文に1件でも当たったら却下する(組み込みルールより厳しい基準)
const BENIGN_SAMPLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "benign-samples.json"), "utf-8")
).map((s) => s.text);

const MAX_SOURCE_LENGTH = 200;
const MAX_MATCH_MS = 50;

// 正規表現のソースとして危ないものを弾く(処理が極端に遅くなる入れ子の繰り返し、後方参照など)
function unsafeReason(source) {
  if (typeof source !== "string" || !source) return "正規表現が空";
  if (source.length > MAX_SOURCE_LENGTH) return `正規表現が長すぎる(${source.length}文字)`;
  if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(source)) return "入れ子の繰り返し(処理が極端に遅くなるおそれ)";
  if (/\\[1-9]|\\k</.test(source)) return "後方参照は使わない";
  if (/^\.\*|\.\*$|^\.\+/.test(source)) return "何にでも当たりすぎる";
  return null;
}

// 提案1件を検証する。問題なければ { ok: true, rule }、ダメなら { ok: false, reasons }
function validateProposal(p, existingIds = []) {
  const reasons = [];
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(p?.id || "")) reasons.push("id は英小文字・数字・_ で3〜41文字");
  if (existingIds.includes(p?.id)) reasons.push(`id「${p.id}」は既にある`);
  if (typeof p?.label !== "string" || !p.label.trim() || p.label.length > 30) reasons.push("label は30文字以内");
  if (!Number.isInteger(p?.weight) || p.weight < 1 || p.weight > 4) reasons.push("weight は1〜4の整数");

  const unsafe = unsafeReason(p?.source);
  if (unsafe) reasons.push(unsafe);

  let regex = null;
  if (!unsafe) {
    try {
      regex = new RegExp(p.source, p.flags === "i" ? "i" : "");
    } catch (err) {
      reasons.push(`正規表現として壊れている: ${err.message}`);
    }
  }

  if (regex) {
    const examples = Array.isArray(p.examples) ? p.examples : [];
    const counters = Array.isArray(p.counter_examples) ? p.counter_examples : [];
    if (examples.length < 2) reasons.push("当たるべき例文が2つ未満");
    for (const e of examples) if (!regex.test(e)) reasons.push(`例文に当たらない:「${e}」`);
    for (const c of counters) if (regex.test(c)) reasons.push(`当たってはいけない例文に当たる:「${c}」`);
    for (const b of BENIGN_SAMPLES) if (regex.test(b)) reasons.push(`普通の電話の例に当たる(誤検知):「${b}」`);

    const long = "あ".repeat(10000) + "い";
    const start = process.hrtime.bigint();
    regex.test(long);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > MAX_MATCH_MS) reasons.push(`処理が遅すぎる(${ms.toFixed(1)}ms)`);
  }

  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    rule: {
      id: p.id,
      label: p.label.trim(),
      weight: p.weight,
      source: p.source,
      flags: p.flags === "i" ? "i" : "",
      examples: p.examples,
      counter_examples: p.counter_examples || [],
      reason: p.reason || "",
    },
  };
}

function builtinIds() {
  return BUILTIN_PATTERNS.map((p) => p.id);
}

module.exports = { validateProposal, unsafeReason, builtinIds, BENIGN_SAMPLES };
