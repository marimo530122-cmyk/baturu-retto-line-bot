const test = require("node:test");
const assert = require("node:assert");
const jev = require("../lib/jev");

const high = { level: "high", label: "詐欺の疑い:高" };
const medium = { level: "medium", label: "詐欺の疑い:中" };
const none = { level: "none", label: "該当なし" };

test("Jevが無いときは正規表現の判定そのまま", () => {
  assert.deepStrictEqual(jev.combine(medium, null), { level: "medium", label: "詐欺の疑い:中", by: "regex" });
});

test("言い回しに引っかからなくても、Jevが詐欺と判定すれば高", () => {
  assert.strictEqual(jev.combine(none, { verdict: "scam_likely", risk: 3 }).level, "high");
});

test("正規表現が中でも、Jevが普通の用件と判定すれば低に下げる", () => {
  assert.strictEqual(jev.combine(medium, { verdict: "legitimate", risk: 0 }).level, "low");
});

test("正規表現が高なら、Jevが普通と言っても高のまま(見逃し防止)", () => {
  assert.strictEqual(jev.combine(high, { verdict: "legitimate", risk: 0 }).level, "high");
});

test("Jevの呼び出しが失敗したら null を返して止まらない", async (t) => {
  process.env.TYPESAFE_API_KEY = "dummy";
  t.after(() => delete process.env.TYPESAFE_API_KEY);
  const orig = global.fetch;
  global.fetch = async () => new Response("boom", { status: 500 });
  t.after(() => (global.fetch = orig));
  assert.strictEqual(await jev.judgeCall([{ role: "caller", text: "還付金です" }]), null);
});

test("Jevの応答を verdict と risk に読み替える", async (t) => {
  process.env.TYPESAFE_API_KEY = "dummy";
  t.after(() => delete process.env.TYPESAFE_API_KEY);
  const orig = global.fetch;
  let sent;
  global.fetch = async (url, opts) => {
    sent = { url, body: JSON.parse(opts.body) };
    return Response.json({ answers: { verdict: { choice: "scam_likely" }, risk: { score: 3 } } });
  };
  t.after(() => (global.fetch = orig));
  const r = await jev.judgeCall([{ role: "caller", text: "お金が戻る手続きがあります" }]);
  assert.deepStrictEqual({ verdict: r.verdict, risk: r.risk }, { verdict: "scam_likely", risk: 3 });
  assert.match(sent.url, /\/v1\/systemone$/);
  assert.deepStrictEqual(Object.keys(sent.body.questions), ["verdict", "risk"]);
});
