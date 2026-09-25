// 監査ログ: AIの提案・機械チェックの結果・人間の承認/却下・ベンチマーク結果を、
// 1行1件の追記専用ファイル(audit/audit-log.jsonl)に「前の行のハッシュ」を含めて記録する。
//
// どれか1行でも書き換えたり消したりすると、それ以降のハッシュのつながりが壊れて verify で分かる
// (改ざん「検知」。ファイルごと作り直す改ざんは防げないので、Git にコミットして履歴を残し、
//  最新のハッシュ(node audit.js head)を別の場所にも控えておくことで補う)。

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const AUDIT_LOG_PATH =
  process.env.SHIELD_AUDIT_LOG || path.join(__dirname, "..", "audit", "audit-log.jsonl");
const GENESIS = "0".repeat(64);

function hashEntry({ seq, at, actor, action, data, prev }) {
  return crypto.createHash("sha256").update(JSON.stringify({ seq, at, actor, action, data, prev })).digest("hex");
}

// 誰が操作したか。SHIELD_OPERATOR > git の user.name > OSのユーザー名
function currentActor() {
  if (process.env.SHIELD_OPERATOR) return process.env.SHIELD_OPERATOR;
  try {
    const name = execFileSync("git", ["config", "user.name"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (name) return name;
  } catch {}
  return os.userInfo().username;
}

function readEntries(file = AUDIT_LOG_PATH) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function append(action, data, actor = currentActor()) {
  const entries = readEntries();
  const last = entries[entries.length - 1];
  const entry = {
    seq: last ? last.seq + 1 : 1,
    at: new Date().toISOString(),
    actor,
    action,
    data,
    prev: last ? last.hash : GENESIS,
  };
  entry.hash = hashEntry(entry);
  fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n");
  return entry;
}

// ハッシュのつながりを最初から検証する。baseEntries を渡すと「過去の版の後ろに追記しただけか」も確認する
function verify(entries = readEntries(), baseEntries = null) {
  const errors = [];
  let prev = GENESIS;
  entries.forEach((e, i) => {
    if (e.seq !== i + 1) errors.push(`${i + 1}行目: 通し番号が ${e.seq}(抜け・入れ替えの疑い)`);
    if (e.prev !== prev) errors.push(`${i + 1}行目(seq ${e.seq}): 前の行とのつながりが切れている`);
    if (hashEntry(e) !== e.hash) errors.push(`${i + 1}行目(seq ${e.seq}): 内容とハッシュが一致しない(書き換えの疑い)`);
    prev = e.hash;
  });
  if (baseEntries) {
    if (entries.length < baseEntries.length) {
      errors.push(`以前の版(${baseEntries.length}件)より件数が減っている(削除の疑い)`);
    }
    baseEntries.forEach((b, i) => {
      if (entries[i] && entries[i].hash !== b.hash) errors.push(`seq ${b.seq}: 以前の版と内容が違う(書き換えの疑い)`);
    });
  }
  return { ok: errors.length === 0, count: entries.length, head: entries.length ? entries[entries.length - 1].hash : GENESIS, errors };
}

module.exports = { AUDIT_LOG_PATH, GENESIS, append, readEntries, verify, hashEntry, currentActor };
