const test = require("node:test");
const assert = require("node:assert");
const intel = require("../lib/intel");
const { extract, needsPoliceNow } = intel;

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

test("名乗った所属(警察署・課・県警・金融庁)を拾い、110番の台本に入れる", () => {
  const found = intel.extract(["藤枝警察署の生活安全課の田中と申します"]);
  assert.ok(found.some((f) => f.type === "org" && f.value === "藤枝警察署の生活安全課"));
  assert.ok(intel.extract(["私は静岡県警の者です"]).some((f) => f.type === "org" && f.value === "静岡県警"));
  assert.ok(!intel.extract(["警察の者です"]).some((f) => f.type === "org"));
  const script = intel.policeScript({ found }).join("\n");
  assert.match(script, /「藤枝警察署の生活安全課の田中」/);
});

test("「銀行の人にも話さないで」のような言い回しを銀行名として拾わない", () => {
  assert.ok(!extract(["ご家族にも銀行の人にも話さないでください"]).some((f) => f.type === "bank"));
  assert.ok(extract(["しずおか銀行藤枝支店です"]).some((f) => f.type === "bank" && f.value === "しずおか銀行藤枝支店"));
});
