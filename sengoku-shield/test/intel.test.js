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
