const test = require("node:test");
const assert = require("node:assert");
const { extract, needsPoliceNow } = require("../lib/intel");

const scamCall = [
  "担当の佐藤と申します。",
  "みずほ銀行新宿支店、口座番号は1234567です。",
  "300万円を用意して、明日の午後3時に新宿駅の東口改札で渡してください。",
  "折り返しは090-1234-5678まで。",
];

test("相手の発言から、口座・金額・日時・場所・名前・電話番号を抜き出す", () => {
  const got = Object.fromEntries(extract(scamCall).map((f) => [f.type, f.value]));
  assert.strictEqual(got.person, "佐藤");
  assert.strictEqual(got.bank, "みずほ銀行新宿支店");
  assert.strictEqual(got.account, "1234567");
  assert.strictEqual(got.amount, "300万円");
  assert.strictEqual(got.datetime, "明日の午後3時");
  assert.strictEqual(got.place, "新宿駅の東口改札");
  assert.strictEqual(got.phone, "090-1234-5678");
});

test("会う日時と場所、または家に来る話がそろったら、すぐ110番を勧める", () => {
  assert.strictEqual(needsPoliceNow(extract(scamCall)), true);
  assert.strictEqual(needsPoliceNow(extract(["係の者がご自宅に伺います"])), true);
  assert.strictEqual(needsPoliceNow(extract(["還付金があります"])), false);
});

test("宅配の日時連絡だけでは、すぐ110番にはならない", () => {
  assert.strictEqual(needsPoliceNow(extract(["宅配便です。明日の朝9時にお届けします。"])), false);
});

test("110番で読み上げる台本に、名前・金額・日時・場所が入る", () => {
  const { policeScript } = require("../lib/intel");
  const { topicsFromIds } = require("../lib/intel");
  const lines = policeScript({ found: extract(scamCall), topics: topicsFromIds(["refund", "authority", "urgency", "cash_demand"]) });
  const text = lines.join("\n");
  assert.match(lines[0], /詐欺だと思う電話がありました/);
  assert.match(text, /「佐藤」と名乗りました/);
  assert.match(text, /還付金やお金の用意の話をされました/); // 名乗り・急がせるは話の中身に入れない
  assert.match(text, /300万円を用意するように言われました/);
  assert.match(text, /明日の午後3時に、新宿駅の東口改札で受け取ると言っています/);
  assert.match(text, /みずほ銀行新宿支店、口座番号1234567/);
  assert.match(lines[lines.length - 1], /あなたのお名前と住所/);
});

test("音声認識の漢数字・全角数字も、番号や時刻として読み取る", () => {
  const got = extract(["口座番号は一二三四五六七です", "電話は〇九〇一二三四五六七八", "明日の三時に駅前の公園で"]).map((f) => `${f.type}:${f.value}`);
  assert.ok(got.includes("account:1234567"), got.join(","));
  assert.ok(got.includes("phone:09012345678"), got.join(","));
  assert.ok(got.includes("datetime:明日の三時"), got.join(","));
  // 「三万円」のような数の言い方は、番号にしない
  assert.ok(extract(["三万円を用意して"]).some((f) => f.type === "amount" && f.value === "三万円"));
});
