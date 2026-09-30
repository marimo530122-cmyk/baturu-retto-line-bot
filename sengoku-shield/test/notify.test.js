const test = require("node:test");
const assert = require("node:assert");
const { familyCallMessage } = require("../lib/notify");

test("固定電話にAIが出た通話の家族向けの知らせに、手がかりと110番の台本が入り、事実でない安心材料は書かない", () => {
  const text = familyCallMessage({
    from: "+819012345678",
    startedAt: "2026-09-30T01:00:00Z",
    history: [
      { role: "caller", text: "藤枝警察署の生活安全課の田中と申します。" },
      { role: "shield", text: "はい" },
      { role: "caller", text: "しずおか銀行藤枝支店、口座番号は1234567です。" },
    ],
    detection: { matches: [{ id: "authority" }, { id: "account_frozen" }] },
  });
  assert.match(text, /口座番号: 1234567/);
  assert.match(text, /実家の親の固定電話に/);
  assert.match(text, /藤枝警察署の生活安全課の田中/);
  assert.ok(!text.includes("9012345678"), "相手の番号は伏せる");
  assert.ok(!/中継|通報しました|警察に送/.test(text), text);
});
