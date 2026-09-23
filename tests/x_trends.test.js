// トレンドのふるい分けのテスト。RSSもJevも実際には呼ばない
// 実行: node --test tests/x_trends.test.js
const test = require("node:test");
const assert = require("node:assert");
const { parseTrendsRss, pickTrend } = require("../x_trends.js");

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>忘年会</title><ht:approx_traffic>2000+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>今年の忘年会、&quot;幹事&quot;の悩みは?</ht:news_item_title></ht:news_item>
</item>
<item><title>台風</title><ht:news_item><ht:news_item_title><![CDATA[台風で被害]]></ht:news_item_title></ht:news_item></item>
<item><title>某俳優</title></item>
<item><title>新商品</title></item>
</channel></rss>`;

// タイトルごとにJevの回答を決めておく
const JUDGE = {
  忘年会: { sensitive: 0.01, named_party: 0.02, fit: 2.9 },
  台風: { sensitive: 0.9, named_party: 0.01, fit: 2.0 },
  某俳優: { sensitive: 0.05, named_party: 0.95, fit: 2.5 },
  新商品: { sensitive: 0.02, named_party: 0.1, fit: 0.8 },
};

function fakeJev(state) {
  const j = JUDGE[state.trend];
  return {
    sensitive: { type: "noul", noul: j.sensitive },
    named_party: { type: "noul", noul: j.named_party },
    fit: { type: "score", score: j.fit },
  };
}

test("RSSからトレンド名と関連ニュース見出しを取り出す", () => {
  const trends = parseTrendsRss(RSS);
  assert.deepStrictEqual(trends.map((t) => t.title), ["忘年会", "台風", "某俳優", "新商品"]);
  assert.deepStrictEqual(trends[0].news, ['今年の忘年会、"幹事"の悩みは?']);
  assert.deepStrictEqual(trends[1].news, ["台風で被害"]);
});

test("不謹慎・実名が主役・相性が低いものを除き、相性が一番高いものを選ぶ", async () => {
  global.fetch = async () => ({ ok: true, text: async () => RSS });
  const states = [];
  const trend = await pickTrend(async (state, questions) => {
    states.push(state);
    assert.deepStrictEqual(Object.keys(questions), ["sensitive", "named_party", "fit"]);
    return fakeJev(state);
  });
  assert.strictEqual(trend.title, "忘年会");
  assert.strictEqual(states.length, 4);
});

test("使えるトレンドが無ければ null", async () => {
  global.fetch = async () => ({ ok: true, text: async () => RSS.replace(/<item><title>忘年会[\s\S]*?<\/item>/, "") });
  assert.strictEqual(await pickTrend(async (state) => fakeJev(state)), null);
});

test("RSS取得やJevが失敗しても null(普段どおりの投稿に戻る)", async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  assert.strictEqual(await pickTrend(fakeJev), null);
  global.fetch = async () => ({ ok: true, text: async () => RSS });
  assert.strictEqual(await pickTrend(async () => { throw new Error("Jev down"); }), null);
});
