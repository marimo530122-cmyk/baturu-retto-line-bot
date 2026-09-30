// 監査ログの確認
//   node audit.js verify               … ハッシュのつながりを検証(改ざん・削除がないか)
//   node audit.js verify --base <file> … 以前の版(<file>)の後ろに追記しただけかも確認(CI用)
//   node audit.js head                 … 最新の件数とハッシュ(別の場所に控えておく用)
//   node audit.js show [件数]          … 最近の記録を表示(既定 20件)

const fs = require("fs");
const audit = require("./lib/audit");

function parseEntries(text) {
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "verify") {
  const baseIdx = args.indexOf("--base");
  let base = null;
  if (baseIdx >= 0) {
    const baseFile = args[baseIdx + 1];
    base = fs.existsSync(baseFile) ? parseEntries(fs.readFileSync(baseFile, "utf-8")) : [];
  }
  const result = audit.verify(audit.readEntries(), base);
  if (!result.ok) {
    console.error(`監査ログの検証に失敗しました(${audit.AUDIT_LOG_PATH})`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`監査ログOK: ${result.count}件、最新ハッシュ ${result.head}`);
} else if (cmd === "head") {
  const result = audit.verify();
  console.log(`${result.count}件 ${result.head}`);
} else if (cmd === "show") {
  const n = Number(args[0] || 20);
  for (const e of audit.readEntries().slice(-n)) {
    console.log(`#${e.seq} ${e.at} ${e.actor} ${e.action} ${JSON.stringify(e.data)}`);
  }
} else {
  console.error("使い方: node audit.js verify [--base <file>] | head | show [件数]");
  process.exit(1);
}
