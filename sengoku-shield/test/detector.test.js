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
