// 通知の記録(data/notify-log.jsonl)・管理者への警報・CSV の取り出し口・/health の書き込み点検
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-notifylog-"));
process.env.SHIELD_DATA_DIR = DATA_DIR;
process.env.SHIELD_APP_TOKEN = "app-secret";
process.env.SHIELD_ADMIN_TOKEN = "admin-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
process.env.SHIELD_FAMILY_LINE_IDS = "Ufamily0001,Ufamily0002";
process.env.SHIELD_ADMIN_LINE_ID = "Uadmin0001";
process.env.SHIELD_ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/1/test";
delete process.env.SHIELD_LINE_USER_ID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TYPESAFE_API_KEY;

const guard = require("../lib/guard");
const notifylog = require("../lib/notifylog");
const { notifyFamily } = require("../lib/notify");
const { server } = require("../server");

// LINE と Discord への送信を横取りする。familyFail に入れた送り先だけ 500 にする
function fakeNet(t, { familyFail = [] } = {}) {
  const calls = { line: [], discord: [] };
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.line.me/")) {
      const body = JSON.parse(opts.body);
      calls.line.push(body);
      return new Response("{}", { status: familyFail.includes(body.to) ? 500 : 200 });
    }
    if (String(url).startsWith("https://discord.com/")) {
      calls.discord.push(JSON.parse(opts.body));
      return new Response(null, { status: 204 });
    }
    return realFetch(url, opts);
  };
  t.after(() => (global.fetch = realFetch));
  return calls;
}

function clearLog() {
  fs.rmSync(notifylog.LOG_PATH, { force: true });
}

test("家族への知らせの時刻と成否を1件1行で記録し、会話・LINEのID・電話番号は残さない", async (t) => {
  guard._reset();
  clearLog();
  fakeNet(t);
  const detectedAt = Date.now() - 1500;
  const ok = await notifyFamily(
    { reason_short: "還付金詐欺" },
    "区役所です。還付金があるので090-1234-5678に電話してATMへ",
    { detectedAt, sessionId: "session-abc-123" }
  );
  assert.strictEqual(ok, true);
  const rows = notifylog.readAll();
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.kind, "family_high");
  assert.strictEqual(row.targets, 2);
  assert.strictEqual(row.sent, 2);
  assert.strictEqual(row.result, "ok");
  assert.ok(row.latency_ms >= 1500, `latency ${row.latency_ms}`);
  assert.strictEqual(row.detected_at, new Date(detectedAt).toISOString());
  assert.match(row.session, /^[0-9a-f]{12}$/);
  const raw = fs.readFileSync(notifylog.LOG_PATH, "utf-8");
  for (const secret of ["Ufamily", "session-abc", "還付金", "090", "1234", "区役所"]) {
    assert.ok(!raw.includes(secret), `記録に「${secret}」が入っている: ${raw}`);
  }
});

test("一部しか届かなかったときは partial と理由を記録し、管理者のLINEとDiscordに警報が出る", async (t) => {
  guard._reset();
  clearLog();
  const calls = fakeNet(t, { familyFail: ["Ufamily0002"] });
  const ok = await notifyFamily({ reason_short: "ニセ警察" }, "警察です", { sessionId: "s2" });
  assert.strictEqual(ok, true, "1人に届けば true");
  const [row] = notifylog.readAll();
  assert.strictEqual(row.result, "partial");
  assert.strictEqual(row.sent, 1);
  assert.strictEqual(row.failed, 1);
  assert.strictEqual(row.errors, "500");
  await new Promise((r) => setTimeout(r, 20));
  const adminLine = calls.line.filter((b) => b.to === "Uadmin0001");
  assert.strictEqual(adminLine.length, 1, "管理者のLINEに警報");
  assert.match(adminLine[0].messages[0].text, /一部しか届きませんでした/);
  assert.ok(!adminLine[0].messages[0].text.includes("Ufamily"), "警報に家族のIDは入れない");
  assert.strictEqual(calls.discord.length, 1, "Discord にも警報");
});

test("1件も届かなかったときは failed。通信エラーも理由として残る", async (t) => {
  guard._reset();
  clearLog();
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.line.me/") && JSON.parse(opts.body).to.startsWith("Ufamily")) {
      throw new TypeError("fetch failed");
    }
    return new Response(null, { status: 200 });
  };
  t.after(() => (global.fetch = realFetch));
  const ok = await notifyFamily({ reason_short: "架空請求" }, "未納料金", { sessionId: "s3" });
  assert.strictEqual(ok, false);
  const [row] = notifylog.readAll();
  assert.strictEqual(row.result, "failed");
  assert.strictEqual(row.errors, "network");
});

test("記録を書き込めなくても例外を出さず、管理者に警報を出す(家族への知らせは止めない)", async (t) => {
  guard._reset();
  clearLog();
  const calls = fakeNet(t);
  fs.mkdirSync(notifylog.LOG_PATH); // 記録のファイルの場所をフォルダにして、書き込めなくする
  t.after(() => fs.rmSync(notifylog.LOG_PATH, { recursive: true, force: true }));
  const ok = await notifyFamily({ reason_short: "還付金詐欺" }, "還付金", { sessionId: "s4" });
  assert.strictEqual(ok, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.line.some((b) => b.to === "Uadmin0001" && /書き込めませんでした/.test(b.messages[0].text)));
});

test("CSV は Excel で開けるよう BOM 付き。式として動く値は無害にする", () => {
  const csv = notifylog.toCsv([
    { ts: "2026-12-15T01:00:00.000Z", kind: "family_high", session: "abc", detected_at: "x", latency_ms: 812, targets: 2, sent: 2, failed: 0, result: "ok", errors: "" },
    { ts: "t", kind: "family_account", session: "=HYPERLINK(1)", detected_at: "x", latency_ms: 1, targets: 1, sent: 0, failed: 1, result: "failed", errors: "500,429" },
  ]);
  assert.ok(csv.startsWith("﻿ts,kind,session,detected_at,latency_ms,"));
  assert.match(csv, /family_high,abc,x,812,2,2,0,ok,,家族のLINE: 見守り中に疑い「高」/);
  assert.match(csv, /'=HYPERLINK\(1\)/);
  assert.match(csv, /"500,429"/);
});

test("CSV の取り出し口: 画面は出るが、合言葉が違えば 401、正しければ CSV。合言葉は URL に載せない", async (t) => {
  guard._reset();
  clearLog();
  fakeNet(t);
  await notifyFamily({ reason_short: "還付金詐欺" }, "還付金", { sessionId: "s5" });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const form = await fetch(`${base}/admin/notify-log`);
  assert.strictEqual(form.status, 200);
  assert.match(await form.text(), /method="post"/);

  const post = (token) =>
    fetch(`${base}/admin/notify-log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  assert.strictEqual((await post("wrong")).status, 401);
  const good = await post("admin-secret");
  assert.strictEqual(good.status, 200);
  assert.match(good.headers.get("content-type"), /text\/csv/);
  assert.match(good.headers.get("content-disposition"), /attachment; filename="notify-log-\d{4}-\d{2}-\d{2}\.csv"/);
  const csv = await good.text();
  assert.match(csv, /family_high/);
  assert.ok(!csv.includes("Ufamily"));
  // ?token= では取り出せない(URL に合言葉が残らないように)
  assert.notStrictEqual((await fetch(`${base}/admin/notify-log?token=admin-secret`)).headers.get("content-type"), "text/csv; charset=utf-8");
});

test("/health はデータの保存先に書き込めるかまで確かめ、書き込めなければ 503 と警報", async (t) => {
  guard._reset();
  const calls = fakeNet(t);
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const ok = await fetch(`${base}/health`);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await ok.text(), "ok");

  const probe = path.join(DATA_DIR, ".health-check");
  fs.rmSync(probe, { force: true });
  fs.mkdirSync(probe); // 書き込み先をフォルダにして、書き込めなくする
  t.after(() => fs.rmSync(probe, { recursive: true, force: true }));
  const ng = await fetch(`${base}/health`);
  assert.strictEqual(ng.status, 503);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.line.some((b) => b.to === "Uadmin0001" && /書き込めません/.test(b.messages[0].text)));
});

test("管理者のLINEは SHIELD_ADMIN_LINE_ID があるときだけ。本人・家族のIDには警報を送らない", async (t) => {
  guard._reset();
  const calls = fakeNet(t);
  const saved = process.env.SHIELD_ADMIN_LINE_ID;
  delete process.env.SHIELD_ADMIN_LINE_ID;
  t.after(() => (process.env.SHIELD_ADMIN_LINE_ID = saved));
  guard.alert("test-kind", "テストの警報");
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(calls.line.length, 0);
  assert.strictEqual(calls.discord.length, 1);
});

test("急ぎの知らせ(相手が口座を言った)も、判定した時刻つきで記録される", async (t) => {
  guard._reset();
  clearLog();
  fakeNet(t);
  const escalate = require("../lib/escalate");
  const r = escalate.onCallerSpeech({
    sessionId: "s-account",
    lines: ["しずおか銀行藤枝支店、口座番号は1234567です。そちらに振り込んでください"],
    suspicious: true,
  });
  assert.strictEqual(r.account_notice, "sent");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const rows = notifylog.readAll().filter((x) => x.kind === "family_account");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].result, "ok");
  assert.ok(!fs.readFileSync(notifylog.LOG_PATH, "utf-8").includes("1234567"), "口座番号は記録しない");
});
