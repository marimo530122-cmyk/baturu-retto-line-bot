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
  const ask = elicit.guidance({ missing: [elicit.TARGETS.find((t) => t.key === "account")], suspicious: false });
  assert.match(ask, /口座番号/);
  assert.match(ask, /約束はしないこと/);
  const calm = elicit.guidance({ missing: [elicit.TARGETS.find((t) => t.key === "account")], suspicious: true });
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

// ---- 藤枝署の手口(ニセ警察官・守秘義務の口止め)に合わせた聞き出し(docs/fujieda_scam_context.md) ----

test("警察を名乗って口止めしてきたら、話を合わせて安心させ、名前と所属を聞き返す", async () => {
  const r = await decoy.reply(
    [
      { role: "caller", text: "警察の者です。あなたの口座が犯罪に使われています。" },
      { role: "shield", text: "あらまあ" },
      { role: "caller", text: "捜査の守秘義務がありますので、ご家族にも銀行の人にも話さないでください。" },
    ],
    2 // 偶数ターンでも(交互を待たずに)すぐ返す
  );
  assert.strictEqual(r.strategy.gagged, true);
  assert.strictEqual(r.strategy.police, true);
  assert.strictEqual(r.text, elicit.GAG_CALM + elicit.ASK_IDENTITY_POLICE);
  assert.strictEqual(decoy.isSafeReply(r.text), true);
});

test("警察・役所を名乗ったら、まず名前と所属、次に振込先を聞く", () => {
  const first = elicit.missingTargets(["警察の者です。口座を確認するので、指定の口座に振り込んでください"]).map((m) => m.key);
  assert.deepStrictEqual(first.slice(0, 3), ["identity", "bank", "account"]);
  assert.ok(!first.includes("person"), "名前と所属を聞くので、名前だけを別に聞かない");
  const after = elicit
    .missingTargets(["藤枝警察署の生活安全課の田中と申します", "指定の口座に振り込んでください"])
    .map((m) => m.key);
  assert.strictEqual(after[0], "bank");
});

test("名前だけで所属を言わないうちは、所属も聞き返す", () => {
  const missing = elicit.missingTargets(["警察の田中と申します。振込の確認です"]).map((m) => m.key);
  assert.strictEqual(missing[0], "identity");
});

test("カードや現金を取りに来る話では、受け渡しの日時と場所を名前より先に聞く", () => {
  const missing = elicit.missingTargets(["キャッシュカードを封筒に入れてください。担当の者が受け取りに伺います"]).map((m) => m.key);
  assert.ok(missing.indexOf("meeting") < missing.indexOf("person"), missing.join(","));
});

test("警察を名乗らない口止めには、所属ではなく次の手がかり(口座など)を聞く", () => {
  const plan = { missing: elicit.missingTargets(["息子さんの件です。振込が必要です。このことは誰にも言わないでください"]), ...elicit.scene(["このことは誰にも言わないでください"]) };
  assert.strictEqual(plan.police, false);
  const text = elicit.fallbackPhrase({ ...plan, suspicious: false, turn: 0 });
  assert.ok(text.startsWith(elicit.GAG_CALM), text);
  assert.ok(!text.includes("警察の方なら"), text);
  assert.ok(text.includes("銀行"), text);
});

test("口止めへの返しの作戦指示には、話を合わせる言い方と、約束をしない決まりが入る", () => {
  const g = elicit.guidance({ missing: [elicit.TARGETS[0]], suspicious: false, gagged: true, police: true });
  assert.match(g, /口止め/);
  assert.ok(g.includes(elicit.GAG_CALM) && g.includes(elicit.ASK_IDENTITY_POLICE));
  assert.match(g, /振り込む・渡す・行く・待つ/);
});

test("怪しまれているときは、口止めされても手がかりを聞かず、なだめるだけにする", () => {
  const text = elicit.fallbackPhrase({ missing: [elicit.TARGETS[0]], suspicious: true, gagged: true, police: true, turn: 1 });
  assert.ok(elicit.CALM_PHRASES.includes(text), text);
});

test("口止めへの返しを続けて言わない(同じ返事の繰り返しは機械だとばれる)", () => {
  const plan = { missing: [elicit.TARGETS[0]], suspicious: false, gagged: true, police: true };
  const first = elicit.fallbackPhrase(plan);
  const second = elicit.fallbackPhrase({ ...plan, recentShieldLines: [first] });
  assert.notStrictEqual(first, second);
});

test("新しい決まった言い方も、どれも約束や番号を含まない", () => {
  for (const p of [elicit.GAG_CALM, elicit.ASK_IDENTITY_POLICE, elicit.ASK_PHRASES.identity, elicit.GAG_CALM + elicit.ASK_IDENTITY_POLICE]) {
    assert.strictEqual(decoy.isSafeReply(p), true, p);
  }
});

// ---- Jev: 会話中に、相手の様子・口止め・お金の動かし方を1回でまとめて聞く ----

function mockJev(t, answers, seen = []) {
  process.env.TYPESAFE_API_KEY = "dummy";
  t.after(() => delete process.env.TYPESAFE_API_KEY);
  const orig = global.fetch;
  global.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return Response.json({ answers });
  };
  t.after(() => (global.fetch = orig));
  return seen;
}

test("Jevには1回の問い合わせで、様子・口止め・お金の動かし方を聞く", async (t) => {
  const seen = mockJev(t, { engagement: { choice: "cooperating" } });
  await decoy.reply([{ role: "caller", text: "警察の者です" }], 1);
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(Object.keys(seen[0].questions).sort(), ["engagement", "gag", "method"]);
});

test("言い換えの口止め(ご内密に)は言葉では拾えないが、Jevが口止めと判定したら話を合わせる", async (t) => {
  const lines = [{ role: "caller", text: "警察の者です。この件はご内密にお願いします" }];
  assert.strictEqual(elicit.scene(lines.map((l) => l.text)).gagged, false, "言葉だけでは拾えない前提");
  mockJev(t, { engagement: { choice: "cooperating" }, gag: { choice: "gagging" }, method: { choice: "unknown" } });
  const r = await decoy.reply(lines, 2);
  assert.strictEqual(r.strategy.gagged, true);
  assert.ok(r.text.startsWith(elicit.GAG_CALM), r.text);
  assert.ok(r.text.includes("お名前と所属"), r.text);
});

test("言葉で口止めを拾えたら、Jevが見逃しても口止めとして扱う", async (t) => {
  mockJev(t, { engagement: { choice: "cooperating" }, gag: { choice: "not_gagging" } });
  const r = await decoy.reply([{ role: "caller", text: "守秘義務がありますので、誰にも言わないでください" }], 2);
  assert.strictEqual(r.strategy.gagged, true);
});

test("「お金を安全な所へ移す」のような言い換えでも、Jevが振込と判定したら振込先を聞く", async (t) => {
  const text = "あなたのお金が狙われています。安全な所へ移す手続きをします";
  assert.ok(!elicit.missingTargets([text]).some((m) => m.key === "bank"), "言葉だけでは振込先を聞かない前提");
  mockJev(t, { engagement: { choice: "cooperating" }, gag: { choice: "not_gagging" }, method: { choice: "transfer" } });
  const r = await decoy.reply([{ role: "caller", text }], 1);
  assert.strictEqual(r.strategy.method, "transfer");
  assert.ok(r.strategy.missing.includes("銀行名と支店"), r.strategy.missing.join(","));
});

test("Jevが受け渡しと判定したら、受け渡しの日時と場所を聞く対象に入れる", () => {
  const keys = elicit.missingTargets(["大事な物をお預かりする手続きです"], { method: "handover" }).map((m) => m.key);
  assert.ok(keys.includes("meeting"), keys.join(","));
});

test("Jevが失敗・おかしな答えでも、言葉の判定だけで続ける", async (t) => {
  mockJev(t, { gag: { choice: "maybe" }, method: { choice: "???" } });
  const r = await decoy.reply([{ role: "caller", text: "振込の手続きです" }], 1);
  assert.strictEqual(r.strategy.gagged, false);
  assert.strictEqual(r.strategy.method, null);
  assert.ok(r.text);
});

test("還付金の「ATMで受け取れます」は受け渡しの話に数えない(いつ・どこでを聞かない)", () => {
  const keys = elicit.missingTargets(["還付金があります。お近くのATMで受け取れますので行ってください"]).map((m) => m.key);
  assert.ok(!keys.includes("meeting"), keys.join(","));
  assert.ok(keys.includes("bank"), keys.join(","));
});
