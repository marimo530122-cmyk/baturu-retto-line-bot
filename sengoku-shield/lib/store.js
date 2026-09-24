const fs = require("fs");
const path = require("path");

// 通話ログは data/calls/<CallSid>.json に保存する(data/ は Git に入れない)
const DATA_DIR = process.env.SHIELD_DATA_DIR || path.join(__dirname, "..", "data");
const CALLS_DIR = path.join(DATA_DIR, "calls");

function callPath(callSid) {
  if (!/^[A-Za-z0-9]+$/.test(callSid)) throw new Error(`不正なCallSid: ${callSid}`);
  return path.join(CALLS_DIR, `${callSid}.json`);
}

function load(callSid) {
  try {
    return JSON.parse(fs.readFileSync(callPath(callSid), "utf-8"));
  } catch {
    return null;
  }
}

function save(call) {
  fs.mkdirSync(CALLS_DIR, { recursive: true });
  fs.writeFileSync(callPath(call.callSid), JSON.stringify(call, null, 2));
}

function list() {
  if (!fs.existsSync(CALLS_DIR)) return [];
  return fs
    .readdirSync(CALLS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(CALLS_DIR, f), "utf-8")))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

module.exports = { DATA_DIR, load, save, list };
