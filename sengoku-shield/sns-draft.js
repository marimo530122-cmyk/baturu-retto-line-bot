// 通話ログから「注意喚起SNS投稿の下書き」を作る。自動投稿はしない。
//
// 誤検知だった場合に、無関係の人や会社を詐欺扱いしてしまう(名誉毀損)おそれがあるため、
// 下書きは必ず人間が読んで確認し、自分の手で投稿すること。
//
//   node sns-draft.js <CallSid>

const fs = require("fs");
const path = require("path");
const store = require("./lib/store");
const { maskText } = require("./lib/mask");

const callSid = process.argv[2];
if (!callSid) {
  console.error("使い方: node sns-draft.js <CallSid>");
  process.exit(1);
}
const call = store.load(callSid);
if (!call) {
  console.error(`通話ログが見つかりません: ${callSid}`);
  process.exit(1);
}
if (!call.detection.matches.length) {
  console.error("詐欺パターンに該当しない通話なので、下書きは作りません。");
  process.exit(1);
}

// 長い発話は切り詰める。伏せ字の途中で切れないようにする
function shorten(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  if (cut.lastIndexOf("[") > cut.lastIndexOf("]")) cut = cut.slice(0, cut.lastIndexOf("["));
  return `${cut}…`;
}

const date = call.startedAt.slice(0, 10);
const techniques = call.detection.matches.map((m) => `・${m.label}`).join("\n");
const quotes = call.history
  .filter((h) => h.role === "caller")
  .slice(0, 3)
  .map((h) => `「${shorten(maskText(h.text), 60)}」`)
  .join("\n");

const draft = `# SNS投稿下書き(未確認)

> **投稿前チェックリスト**(全部OKになるまで投稿しない)
> - [ ] 会社名・個人名・電話番号など、特定の誰かが分かる情報が入っていない
> - [ ] 「詐欺と断定」ではなく「こういう電話があったので注意」という書き方になっている
> - [ ] 会話の引用が、実際の録音・ログの内容と食い違っていない

---

【注意喚起】${date}、こんな電話がかかってきました。

${quotes}

よくある手口の特徴:
${techniques}

同じような電話が来たら、その場で払ったり教えたりせず、いったん切って家族や警察相談専用電話(#9110)に相談してください。

#詐欺電話 #注意喚起
`;

const outDir = path.join(store.DATA_DIR, "drafts");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${date}-${callSid}.md`);
fs.writeFileSync(outPath, draft);
console.log(draft);
console.log(`下書きを保存しました: ${outPath}`);
console.log("※自動投稿はしません。内容を確認してから手動で投稿してください。");
