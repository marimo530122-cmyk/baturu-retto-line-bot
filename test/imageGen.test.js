"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateEpisodeImage, buildPrompt } = require("../lib/imageGen");

const episode = { title: "【泥沼編】友達同士・合コンの神回", text: "本文" };

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  Object.assign(process.env, vars);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(vars)) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    });
}

test("buildPrompt はタイトルの装飾記号を除去してスタイル指定を付与する", () => {
  const prompt = buildPrompt(episode);
  assert.ok(!prompt.includes("【"));
  assert.ok(prompt.includes("no text"));
});

test("IMAGE_PROVIDER 未設定なら null を返す(テキストのみへフォールバック)", async () => {
  await withEnv({ IMAGE_PROVIDER: "" }, async () => {
    delete process.env.IMAGE_PROVIDER;
    const result = await generateEpisodeImage(episode);
    assert.equal(result, null);
  });
});

test("未知の IMAGE_PROVIDER は null を返す", async () => {
  await withEnv({ IMAGE_PROVIDER: "unknown-provider" }, async () => {
    const result = await generateEpisodeImage(episode);
    assert.equal(result, null);
  });
});

test("fal プロバイダーは画像URLを返す", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.ok(url.startsWith("https://fal.run/"));
    assert.equal(opts.headers.Authorization, "Key test-fal-key");
    return {
      ok: true,
      json: async () => ({ images: [{ url: "https://cdn.fal.ai/example.png" }] }),
    };
  };
  try {
    await withEnv({ IMAGE_PROVIDER: "fal", FAL_KEY: "test-fal-key" }, async () => {
      const result = await generateEpisodeImage(episode);
      assert.deepEqual(result, { url: "https://cdn.fal.ai/example.png" });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("fal 呼び出しがAPIエラーを返すと null にフォールバックする", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "internal error",
  });
  try {
    await withEnv({ IMAGE_PROVIDER: "fal", FAL_KEY: "test-fal-key" }, async () => {
      const result = await generateEpisodeImage(episode);
      assert.equal(result, null);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("automatic1111 プロバイダーは base64 画像を返す", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url, "http://localhost:7860/sdapi/v1/txt2img");
    return { ok: true, json: async () => ({ images: ["ZmFrZS1wbmc="] }) };
  };
  try {
    await withEnv(
      { IMAGE_PROVIDER: "automatic1111", A1111_API_URL: "http://localhost:7860/" },
      async () => {
        const result = await generateEpisodeImage(episode);
        assert.deepEqual(result, { base64: "ZmFrZS1wbmc=", mime: "image/png" });
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
