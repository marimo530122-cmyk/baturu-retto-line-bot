const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SHIELD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shield-call-"));
process.env.TWILIO_ACCOUNT_SID = "AC123";
process.env.TWILIO_AUTH_TOKEN = "twilio-token";
process.env.SHIELD_CALLER_ID = "+815012345678";
process.env.SHIELD_FAMILY_PHONES = "090-1111-2222";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
process.env.SHIELD_FAMILY_LINE_IDS = "Ufamily";

const familycall = require("../lib/familycall");
const escalate = require("../lib/escalate");

const calls = [];
const lines = [];
global.fetch = async (url, opts) => {
  if (String(url).includes("api.twilio.com")) calls.push({ url: String(url), headers: opts.headers, body: new URLSearchParams(opts.body) });
  if (String(url).includes("api.line.me")) lines.push(JSON.parse(opts.body).messages[0].text);
  return new Response("{}", { status: 201 });
};

test("家族への電話は、日時・場所・口座のことと「代わりに110番を」を読み上げる", () => {
  const msg = familycall.callMessage({ datetime: "明日の午後3時", place: "新宿駅の東口改札", bank: "みずほ銀行新宿支店", account: "1234567" });
  assert.match(msg, /明日の午後3時に、新宿駅の東口改札で受け取ると言っています/);
  assert.match(msg, /みずほ銀行新宿支店の口座を言いました/);
  assert.match(msg, /代わりに110番をお願いします/);
  assert.doesNotMatch(msg, /1234567/); // 番号の読み上げは聞き取りにくいのでLINEで送る
  const twiml = familycall.callTwiml("A&B<C>");
  assert.match(twiml, /A&amp;B&lt;C&gt;/);
  assert.strictEqual((twiml.match(/<Say /g) || []).length, 2); // 聞き逃さないよう2回
});

test("相手が会う日時と場所を言ったら、登録された家族に1回だけ自動電話をかける", async () => {
  const say = (t) =>
    escalate.onCallerSpeech({ sessionId: "sess-call-1", lines: ["還付金があります", t], suspicious: true });
  const first = say("明日の午後3時に新宿駅の東口改札で渡してください");
  assert.strictEqual(first.call_notice, "calling");
  assert.strictEqual(say("明日の午後3時に新宿駅の東口改札ですよ").call_notice, "none");
  await new Promise((r) => setTimeout(r, 30));

  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /Accounts\/AC123\/Calls\.json$/);
  assert.strictEqual(calls[0].body.get("To"), "+819011112222");
  assert.strictEqual(calls[0].body.get("From"), "+815012345678");
  assert.match(calls[0].body.get("Twiml"), /新宿駅の東口改札で受け取ると言っています/);
  assert.strictEqual(calls[0].headers.Authorization, `Basic ${Buffer.from("AC123:twilio-token").toString("base64")}`);
});

test("相手が口座を言ったら、LINEで口座を送り、電話もかける", async () => {
  calls.length = 0;
  lines.length = 0;
  const r = escalate.onCallerSpeech({ sessionId: "sess-call-2", lines: ["口座番号は一二三四五六七です"], suspicious: true });
  assert.deepStrictEqual(r, { account_notice: "sent", call_notice: "calling" });
  await new Promise((res) => setTimeout(res, 30));
  assert.match(lines[0], /口座番号: 1234567/); // 漢数字も数字にそろえて送る
  assert.strictEqual(calls.length, 1);
});

test("詐欺の疑いがない電話では、何も送らず電話もかけない", () => {
  const r = escalate.onCallerSpeech({
    sessionId: "sess-call-3",
    lines: ["明日の午後3時に新宿駅の東口改札で待ち合わせね"],
    suspicious: false,
  });
  assert.deepStrictEqual(r, { account_notice: "none", call_notice: "none" });
});
