"use strict";

const STYLE_SUFFIX =
  "comic illustration style, vibrant colors, festive party atmosphere, " +
  "roulette wheel motif, no text, no words, no letters, no watermark";

function buildPrompt(episode) {
  const title = (episode.title || "").replace(/[【】]/g, " ").trim();
  return `${title}, Japanese drinking-game party scene, ${STYLE_SUFFIX}`;
}

async function generateWithFal(prompt) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY が設定されていません。");
  const model = process.env.FAL_MODEL || "fal-ai/flux/schnell";

  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({ prompt, image_size: "square_hd" }),
  });

  if (!res.ok) {
    throw new Error(`fal.ai 画像生成失敗: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const url = data && data.images && data.images[0] && data.images[0].url;
  if (!url) throw new Error("fal.ai のレスポンスに画像URLがありません。");
  return { url };
}

async function generateWithStability(prompt) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error("STABILITY_API_KEY が設定されていません。");

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");

  const res = await fetch(
    "https://api.stability.ai/v2beta/stable-image/generate/core",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "image/*",
      },
      body: form,
    }
  );

  if (!res.ok) {
    throw new Error(
      `Stability AI 画像生成失敗: ${res.status} ${await res.text()}`
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { base64: buffer.toString("base64"), mime: "image/png" };
}

async function generateWithAutomatic1111(prompt) {
  const baseUrl = process.env.A1111_API_URL;
  if (!baseUrl) throw new Error("A1111_API_URL が設定されていません。");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 20, width: 768, height: 768 }),
  });

  if (!res.ok) {
    throw new Error(
      `AUTOMATIC1111 画像生成失敗: ${res.status} ${await res.text()}`
    );
  }

  const data = await res.json();
  const image = data && data.images && data.images[0];
  if (!image) throw new Error("AUTOMATIC1111 のレスポンスに画像がありません。");
  return { base64: image, mime: "image/png" };
}

const PROVIDERS = {
  fal: generateWithFal,
  stability: generateWithStability,
  automatic1111: generateWithAutomatic1111,
};

/**
 * IMAGE_PROVIDER が未設定、または該当プロバイダーが失敗した場合は null を返す。
 * 呼び出し側はテキストのみの配信にフォールバックすること。
 */
async function generateEpisodeImage(episode) {
  const provider = process.env.IMAGE_PROVIDER;
  if (!provider) return null;

  const generate = PROVIDERS[provider];
  if (!generate) {
    console.error(`未知の IMAGE_PROVIDER: ${provider}`);
    return null;
  }

  try {
    return await generate(buildPrompt(episode));
  } catch (err) {
    console.error(`画像生成に失敗したためテキストのみ配信します: ${err.message}`);
    return null;
  }
}

module.exports = { generateEpisodeImage, buildPrompt, PROVIDERS };
