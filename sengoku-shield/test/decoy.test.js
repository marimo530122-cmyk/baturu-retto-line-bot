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

test("本人の声の性別に合わせて、AIの話し方の指示を変える", () => {
  assert.match(decoy.systemPrompt("male"), /年配の男性/);
  assert.match(decoy.systemPrompt("female"), /年配の女性/);
  assert.strictEqual(decoy.systemPrompt("unknown"), decoy.SYSTEM_PROMPT);
  assert.strictEqual(decoy.normalizeGender("male"), "male");
  assert.strictEqual(decoy.normalizeGender("toString"), null);
});

test("Twilio の読み上げ声は SHIELD_VOICE_GENDER で男性・女性を切り替える", () => {
  const { execFileSync } = require("child_process");
  const path = require("path");
  const run = (env) =>
    execFileSync("node", ["-e", 'process.stdout.write(require("./lib/twilio").say("はい"))'], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, TWILIO_VOICE: "", ...env },
    }).toString();
  assert.match(run({ SHIELD_VOICE_GENDER: "male" }), /voice="Polly\.Takumi"/);
  assert.match(run({ SHIELD_VOICE_GENDER: "female" }), /voice="Polly\.Mizuki"/);
  assert.match(run({ SHIELD_VOICE_GENDER: "male", TWILIO_VOICE: "Polly.Kazuha" }), /voice="Polly\.Kazuha"/);
});
