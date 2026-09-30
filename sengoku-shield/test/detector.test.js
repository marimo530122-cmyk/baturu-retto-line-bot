const test = require("node:test");
const assert = require("node:assert");
const { detect, score } = require("../lib/detector");

test("還付金詐欺の典型的な発話は「高」になる", () => {
  const r = score([
    "市役所の保険課です。医療費の還付金があります。",
    "今日中にお近くのATMに行ってください。",
    "キャッシュカードをお持ちですか。",
  ]);
  assert.strictEqual(r.level, "high");
  assert.deepStrictEqual(
    r.matches.map((m) => m.id).sort(),
    ["atm", "authority", "card_pin", "refund", "urgency"].sort()
  );
});

test("架空請求(ギフトカード払い)を検知する", () => {
  const ids = detect("未納料金があります。コンビニでアマゾンのギフトカードを買ってください").map((m) => m.id);
  assert.ok(ids.includes("gift_card"));
  assert.ok(ids.includes("unpaid_legal"));
});

test("普通の用件は該当なし", () => {
  const r = score(["宅配便です。お荷物のお届け日時の確認でお電話しました。"]);
  assert.strictEqual(r.level, "none");
  assert.strictEqual(r.score, 0);
});

test("同じパターンは何回出ても1回だけ数える", () => {
  const r = score(["ATMに行って", "ATMはどこですか", "ATM"]);
  assert.strictEqual(r.score, 4);
});

test("口止め(守秘義務)と窓口での口裏合わせを拾い、普通の守秘義務の説明は拾わない", () => {
  const ids = (t) => score([t]).matches.map((m) => m.id);
  assert.ok(ids("捜査の守秘義務がありますので、ご家族にも話さないでください").includes("secrecy"));
  assert.ok(ids("銀行で理由を聞かれたら、リフォーム代と答えてください").includes("bank_cover_story"));
  assert.strictEqual(score(["病院です。守秘義務がありますので、検査結果はお電話ではお伝えできません。"]).level, "none");
});

test("代わりの人がお金を取りに来る話・カードを封筒に入れさせる話を拾い、普通の用事は拾わない", () => {
  const ids = (t) => score([t]).matches.map((m) => m.id);
  assert.ok(ids("俺は行けないから、代わりに上司が現金を受け取りに行くから渡して").includes("proxy_pickup"));
  assert.ok(ids("キャッシュカードを封筒に入れて、割印を押してください").includes("card_swap"));
  assert.strictEqual(score(["代わりに妻が荷物を取りに行きます"]).level, "none");
  assert.strictEqual(score(["契約書を2部お送りしますので、両方に割印をしてご返送ください。"]).level, "none");
});

test("警察を名乗ってビデオ通話・LINEに誘う話を拾い、家族のビデオ通話や警察の呼びかけには反応しない", () => {
  const ids = (t) => score([t]).matches.map((m) => m.id);
  assert.ok(ids("警察の者です。確認のためビデオ通話に切り替えてください").includes("police_video_call"));
  assert.ok(!ids("日曜日にビデオ通話しようね").includes("police_video_call"));
  assert.ok(!ids("警察がビデオ通話をすることは絶対にありません").includes("police_video_call"));
});
