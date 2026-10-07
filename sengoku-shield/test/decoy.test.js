const test = require("node:test");
const assert = require("node:assert");
delete process.env.ANTHROPIC_API_KEY;
const decoy = require("../lib/decoy");

test("APIキーが無いときは固定文面で応答する", async () => {
  const r = await decoy.reply([{ role: "caller", text: "還付金があります" }], 1);
  assert.strictEqual(r.source, "fixed");
  // 時間稼ぎ・聞き出し・なだめの、どれかの決まった言い方になる
  const { ASK_PHRASES, CALM_PHRASES } = require("../lib/elicit");
  assert.ok([...decoy.STALL_PHRASES, ...Object.values(ASK_PHRASES), ...CALM_PHRASES].includes(r.text), r.text);
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

test("AIの返事が約束(振り込む・渡す・行く・待つ)になっていたら読み上げない", () => {
  for (const t of ["はい、明日振り込みます。", "わかりました、駅で待ってます。", "じゃあ3時に行きますね。", "駅でお待ちしています", "うちの住所は…"]) {
    assert.strictEqual(decoy.isSafeReply(t), false, t);
  }
  for (const t of ["メモしますから、口座番号をもう一度ゆっくりお願いします。", "お名前、なんておっしゃいましたっけ。", ...decoy.STALL_PHRASES]) {
    assert.strictEqual(decoy.isSafeReply(t), true, t);
  }
});

test("見抜いていると分かる言葉や注意は読み上げない(気づかれて切られないように)", () => {
  for (const t of ["それは詐欺じゃないですか。", "なんだか怪しいお話ですねえ。", "警察に通報しますよ。", "お気をつけくださいね。"]) {
    assert.strictEqual(decoy.isSafeReply(t), false, t);
  }
  for (const t of ["あらまあ、お金が戻ってくるんですか。", "警察の方なら、メモをちゃんと残したいので、お名前と所属をもう一度教えてもらえますか。"]) {
    assert.strictEqual(decoy.isSafeReply(t), true, t);
  }
});

test("家に来るよう誘う・家族に話すと言う・お金を動かすつもりに聞こえる返事は読み上げない", () => {
  for (const t of [
    "機械はさっぱりでねえ。誰か家に来て教えてくれるのかい。",
    "いつ頃来られるの。",
    "後で家族に見せるから、お名前を教えてください。",
    "それで、どこに振り込めばいいんだっけ。",
    "どの番号にすればいいのかねえ。",
  ]) {
    assert.strictEqual(decoy.isSafeReply(t), false, t);
  }
  for (const t of [
    "ちょっと耳が遠くてねえ。何支店って言ったかね。",
    "間違えると困るから、窓口の電話番号も控えておきますね。",
    "いつ、どこって言いました? メモしますから。",
  ]) {
    assert.strictEqual(decoy.isSafeReply(t), true, t);
  }
});

test("期限までに連絡・振込する約束に聞こえる返事は読み上げない", () => {
  assert.strictEqual(decoy.isSafeReply("何時までに連絡すればいいのかね。"), false);
  assert.strictEqual(decoy.isSafeReply("お名前、どういう字を書きますか。メモが間違うといけないから。"), true);
});
