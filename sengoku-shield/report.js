// 通話ログの一覧を表示する
//   node report.js          … 一覧
//   node report.js <CallSid> … 1件の会話全文

const store = require("./lib/store");
const { maskPhone } = require("./lib/mask");

const callSid = process.argv[2];

// 通話終了前のログには verdict が無いので、正規表現の判定を出す
function label(call) {
  return call.verdict ? `${call.verdict.label}(${call.verdict.by})` : call.detection.label;
}

if (callSid) {
  const call = store.load(callSid);
  if (!call) {
    console.error(`通話ログが見つかりません: ${callSid}`);
    process.exit(1);
  }
  console.log(`${call.startedAt}  ${maskPhone(call.from)}  ${call.durationSec ?? "?"}秒  ${label(call)}`);
  if (call.jev) console.log(`  Jev: ${call.jev.verdict ?? "-"} / 危険度 ${call.jev.risk ?? "-"}(0〜3)`);
  for (const m of call.detection.matches) console.log(`  - ${m.label}(「${m.hit}」)`);
  console.log("");
  for (const h of call.history) {
    console.log(`${h.role === "caller" ? "相手" : "応答"}: ${h.text}`);
  }
} else {
  const calls = store.list();
  if (!calls.length) console.log("通話ログはまだありません。");
  for (const c of calls) {
    console.log(
      [c.startedAt, c.callSid, maskPhone(c.from), `${c.durationSec ?? "?"}秒`, label(c)].join("  ")
    );
  }
}
