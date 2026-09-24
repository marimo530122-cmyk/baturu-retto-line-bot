const test = require("node:test");
const assert = require("node:assert");
delete process.env.ANTHROPIC_API_KEY;
const decoy = require("../lib/decoy");

test("APIキーが無いときは固定文面で応答する", async () => {
  const r = await decoy.reply([{ role: "caller", text: "還付金があります" }], 1);
  assert.strictEqual(r.source, "fixed");
  assert.ok(decoy.STALL_PHRASES.includes(r.text));
});

test("番号っぽい数字や長すぎる返事は読み上げない", () => {
  assert.strictEqual(decoy.isSafeReply("口座番号は1234567です"), false);
  assert.strictEqual(decoy.isSafeReply("あ".repeat(200)), false);
  assert.strictEqual(decoy.isSafeReply("ちょっと待ってくださいね。"), true);
});

test("会話履歴はuserから始まり、同じ役の連続はまとめる", () => {
  const m = decoy.toMessages([
    { role: "shield", text: "アナウンス" },
    { role: "caller", text: "もしもし" },
    { role: "caller", text: "聞こえますか" },
  ]);
  assert.deepStrictEqual(m, [{ role: "user", content: "もしもし\n聞こえますか" }]);
});
