const test = require("node:test");
const assert = require("node:assert");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TYPESAFE_API_KEY;
const elicit = require("../lib/elicit");
const decoy = require("../lib/decoy");

test("振込の話が出たら、まだ聞けていない銀行・口座から順に聞く", () => {
  const missing = elicit.missingTargets(["還付金があります。振込の手続きをします"]).map((m) => m.key);
  assert.deepStrictEqual(missing.slice(0, 2), ["bank", "account"]);
  const after = elicit.missingTargets(["振込の手続きです", "みずほ銀行新宿支店、口座番号は1234567です"]).map((m) => m.key);
  assert.ok(!after.includes("bank") && !after.includes("account"));
});

test("振込の話が出ていないのに口座は聞かない(不自然になるので)", () => {
  const missing = elicit.missingTargets(["キャッシュカードを封筒に入れて、係の者が取りに伺います"]).map((m) => m.key);
  assert.ok(!missing.includes("account"));
  assert.ok(missing.includes("person"));
});

test("聞き出し・なだめの決まった言い方は、どれも約束になっていない", () => {
  for (const p of [...Object.values(elicit.ASK_PHRASES), ...elicit.CALM_PHRASES]) {
    assert.strictEqual(decoy.isSafeReply(p), true, p);
  }
});

test("AIへの作戦指示: 足りない手がかりを1つ聞く / 怪しまれたらなだめる", () => {
  const ask = elicit.guidance({ missing: [elicit.TARGETS[1]], suspicious: false });
  assert.match(ask, /口座番号/);
  assert.match(ask, /約束はしないこと/);
  const calm = elicit.guidance({ missing: [elicit.TARGETS[1]], suspicious: true });
  assert.match(calm, /手がかりを聞かず/);
});

test("AIが使えなくても、聞き出しと時間稼ぎを交互にし、同じ返事を繰り返さない", async () => {
  const h = [{ role: "caller", text: "還付金があります。振込の手続きをします" }];
  const said = [];
  for (let t = 1; t <= 4; t++) {
    const r = await decoy.reply(h, t);
    said.push(r.text);
    h.push({ role: "shield", text: r.text }, { role: "caller", text: "はい" });
  }
  assert.ok(said.includes(elicit.ASK_PHRASES.bank), said.join(" / "));
  assert.strictEqual(new Set(said).size, said.length, "同じ返事が続いている");
});

test("相手が怪しみ始めたら、聞くのをやめてなだめる(言葉から判断)", async () => {
  const r = await decoy.reply(
    [
      { role: "caller", text: "振込の手続きです" },
      { role: "shield", text: "えーと" },
      { role: "caller", text: "さっきから本当に聞いてるの?" },
    ],
    1
  );
  assert.strictEqual(r.strategy.suspicious, true);
  assert.ok(elicit.CALM_PHRASES.includes(r.text), r.text);
});

test("Jevが「切ろうとしている」と判定したら、なだめてつなぎ止める", async (t) => {
  process.env.TYPESAFE_API_KEY = "dummy";
  t.after(() => delete process.env.TYPESAFE_API_KEY);
  const orig = global.fetch;
  global.fetch = async () => Response.json({ answers: { engagement: { choice: "leaving" } } });
  t.after(() => (global.fetch = orig));
  const r = await decoy.reply([{ role: "caller", text: "振込の手続きです。わかりました、それではまた" }], 1);
  assert.strictEqual(r.strategy.engagement, "leaving");
  assert.ok(elicit.CALM_PHRASES.includes(r.text), r.text);
});
