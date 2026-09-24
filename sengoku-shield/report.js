// 通話ログの一覧を表示する
//   node report.js          … 一覧
//   node report.js <CallSid> … 1件の会話全文

const store = require("./lib/store");
const { maskPhone } = require("./lib/mask");

const callSid = process.argv[2];

if (callSid) {
  const call = store.load(callSid);
  if (!call) {
    console.error(`通話ログが見つかりません: ${callSid}`);
    process.exit(1);
  }
  console.log(`${call.startedAt}  ${maskPhone(call.from)}  ${call.durationSec ?? "?"}秒  ${call.detection.label}`);
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
      [c.startedAt, c.callSid, maskPhone(c.from), `${c.durationSec ?? "?"}秒`, c.detection.label].join("  ")
    );
  }
}
