// 通話ログの一覧を表示する
//   node report.js          … 一覧
//   node report.js <CallSid> … 1件の会話全文

const store = require("./lib/store");
const { maskPhone } = require("./lib/mask");
const { extract, needsPoliceNow } = require("./lib/intel");

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

  // 警察に伝える手がかり(相手の発言から自動で抜き出した候補)。番号は伏せずに出す(本人の手元・警察用)
  const intel = extract(call.history.filter((h) => h.role === "caller").map((h) => h.text));
  console.log("\n警察に伝える手がかり(自動で抜き出した候補):");
  console.log(`  相手の電話番号: ${call.from || "非通知"}`);
  for (const f of intel) console.log(`  ${f.label}: ${f.value}`);
  if (needsPoliceNow(intel)) console.log("  ※ 相手が会う日時・場所や家に来る話をしています。すぐに110番してください。");
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
