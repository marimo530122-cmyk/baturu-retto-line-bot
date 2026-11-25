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

// 通話記録の保存期間(日)。既定は30日。SHIELD_RETENTION_DAYS で変えられる(0以下は消さない)
const RETENTION_DAYS = Number(process.env.SHIELD_RETENTION_DAYS ?? 30);

// 保存期間を過ぎた通話記録を消す。戻り値は消した件数
// 基準は通話の開始時刻(startedAt)。読めないときはファイルの更新時刻を使う
function purgeOld({ now = Date.now(), days = RETENTION_DAYS } = {}) {
  if (!(days > 0) || !fs.existsSync(CALLS_DIR)) return 0;
  const limit = now - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of fs.readdirSync(CALLS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(CALLS_DIR, f);
    try {
      let t = NaN;
      try {
        t = Date.parse(JSON.parse(fs.readFileSync(file, "utf-8")).startedAt);
      } catch {}
      if (Number.isNaN(t)) t = fs.statSync(file).mtimeMs;
      if (t < limit) {
        fs.unlinkSync(file);
        removed++;
      }
    } catch (err) {
      console.error(`[retention] 消せませんでした: ${f}`, err.message);
    }
  }
  return removed;
}

module.exports = { DATA_DIR, load, save, list, purgeOld, RETENTION_DAYS };
