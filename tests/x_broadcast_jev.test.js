// Jevによる投稿前チェックのテスト。実際のAPIは呼ばず fetch を差し替える
// 実行: node --test tests/
const test = require("node:test");
const assert = require("node:assert");

process.env.DRY_RUN = "1";
process.env.TYPESAFE_API_KEY = "test-key";
const { checkAiBody } = require("../x_broadcast.js");

const episode = { topic: "罰ゲームのあるある", text: "参考投稿" };

function mockJev(nouls, { ok = true } = {}) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const answers = Object.fromEntries(
      Object.entries(nouls).map(([name, noul]) => [name, { type: "noul", noul }])
    );
    return {
      ok,
      status: ok ? 200 : 503,
      json: async () => ({ model: "jev", answers, usage: {} }),
      text: async () => "unavailable",
    };
  };
  return calls;
}

test("問題なしなら通過し、Jevに3つの質問をまとめて1回だけ送る", async () => {
  const calls = mockJev({ drinking: 0.02, real_names: 0.1, invented_facts: 0.3 });
  await checkAiBody(episode, "ルーレットで変顔が決まった");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.strictEqual(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.strictEqual(calls[0].body.model, "jev-latest");
  assert.deepStrictEqual(calls[0].body.state, {
    topic: episode.topic,
    reference: episode.text,
    post: "ルーレットで変顔が決まった",
  });
  assert.deepStrictEqual(Object.keys(calls[0].body.questions), [
    "drinking",
    "real_names",
    "invented_facts",
  ]);
});

test("違反の確率が閾値以上なら例外(=固定文面に切り替え)", async () => {
  mockJev({ drinking: 0.91, real_names: 0.1, invented_facts: 0.6 });
  await assert.rejects(checkAiBody(episode, "イッキ!"), (err) => {
    assert.match(err.message, /飲酒の強要/);
    assert.match(err.message, /テーマにない事実/);
    assert.doesNotMatch(err.message, /実在の人物/);
    return true;
  });
});

test("Jev APIが失敗したら例外(=固定文面に切り替え)", async () => {
  mockJev({}, { ok: false });
  await assert.rejects(checkAiBody(episode, "本文"), /Jev判定に失敗/);
});
