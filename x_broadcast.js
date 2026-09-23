const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// DRY_RUN=1 のときはXに投稿せず、投稿予定の文面を表示するだけ
const DRY_RUN = process.env.DRY_RUN === "1";

const URL_VARS = {
  GAME_URL: process.env.GAME_URL || "https://marimo530122-cmyk.github.io/baturu-retto/",
  MIKUCHIWARI_URL: process.env.MIKUCHIWARI_URL,
  AFFILIATE_URL: process.env.AFFILIATE_URL,
};

// ANTHROPIC_API_KEY があれば、その日のテーマでClaudeが毎回新しい本文を書く。
// 無い・失敗した・ルール違反の文面が返ってきた場合は x_episodes.json の固定文面で投稿する
const AI_MODEL = "claude-opus-5";
const USE_AI = Boolean(process.env.ANTHROPIC_API_KEY);

const CREDENTIALS = {
  consumerKey: process.env.X_API_KEY,
  consumerSecret: process.env.X_API_SECRET,
  token: process.env.X_ACCESS_TOKEN,
  tokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
};

if (!DRY_RUN && Object.values(CREDENTIALS).some((v) => !v)) {
  console.error(
    "X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET が設定されていません。"
  );
  process.exit(1);
}

const episodes = JSON.parse(
  fs.readFileSync(path.join(__dirname, "x_episodes.json"), "utf-8")
);

// リンク先URLが未設定のテンプレート(三口割り・アフィリエイト等)はスキップする
function availableEpisodes() {
  return episodes.filter((e) => (e.requires || []).every((key) => URL_VARS[key]));
}

function pickEpisode() {
  const candidates = availableEpisodes();
  const start = new Date(new Date().getFullYear(), 0, 0);
  const now = new Date();
  const dayOfYear = Math.floor((now - start) / 86400000);
  return candidates[dayOfYear % candidates.length];
}

// ステマ規制(景品表示法)対応: 広告・アフィリエイトを含む投稿は必ず先頭で明示する
function withAdLabel(episode, text) {
  return episode.ad ? `【PR】${text}` : text;
}

function render(episode) {
  let text = episode.text;
  for (const [key, value] of Object.entries(URL_VARS)) {
    if (value) text = text.replaceAll(`{{${key}}}`, value);
  }
  return withAdLabel(episode, text);
}

// AIが書くのは本文だけ。URL・ハッシュタグ・【PR】はプログラム側で必ず付ける
// (AIにURLを書かせると存在しないリンクや表記漏れが起きうるため)
function composeAiPost(episode, body) {
  const suffix = `\n\n▶ ${URL_VARS[episode.link]}\n\n${episode.hashtags}`;
  return withAdLabel(episode, body + suffix);
}

const AI_SYSTEM_PROMPT = `あなたは飲み会向けミニツール(罰ゲームルーレット・割り勘計算など)のX(旧Twitter)運用担当です。
与えられたテーマで、思わず続きを読みたくなる投稿の「本文だけ」を日本語で書いてください。

ルール:
- 本文のみを出力する。前置き・説明・カギ括弧での囲みは不要
- URL、ハッシュタグ、【PR】などの広告表記は書かない(後でプログラムが付け足す)
- 指定された文字数以内、2〜4行、絵文字は1〜2個まで
- 実在の人物・企業・店名を出さない
- テーマに書かれていない事実(利用者数、効果、価格、割引など)を作らない
- イッキ飲み、飲酒の強要、未成年の飲酒を連想させる内容にしない
- 参考投稿をそのまま使わず、毎回違う切り口・状況で書く`;

async function generateAiBody(episode, maxChars) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);

  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    // 安全フィルタで断られた場合に、推奨の別モデルで自動再実行させる
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: AI_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `日付: ${today}\n` +
          `テーマ: ${episode.topic}\n` +
          `文字数: 全角${maxChars}文字以内\n\n` +
          `参考投稿(このまま使わないこと):\n${episode.text}`,
      },
    ],
  });

  if (response.stop_reason !== "end_turn") {
    throw new Error(`AI生成が完了しませんでした (stop_reason: ${response.stop_reason})`);
  }

  const body = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
    .replace(/^[「『"]+|[」』"]+$/g, "")
    .trim();

  if (!body) throw new Error("AIの本文が空でした");
  if (/https?:\/\/|#|＃|【PR】/.test(body)) {
    throw new Error(`AIの本文にURL・ハッシュタグ・PR表記が含まれていました: ${body}`);
  }
  return body;
}

// その日の投稿文を決める。AIが使えればAI版、ダメなら固定文面
async function buildPost(episode) {
  if (USE_AI) {
    try {
      const fixedPart = weightedLength(composeAiPost(episode, ""));
      const maxChars = Math.floor((280 - fixedPart) / 2) - 5;
      const text = composeAiPost(episode, await generateAiBody(episode, maxChars));
      if (weightedLength(text) > 280) {
        throw new Error(`AIの文面が文字数オーバー(${weightedLength(text)}/280)`);
      }
      return { text, source: "AI" };
    } catch (err) {
      console.warn(`AI生成をスキップして固定文面を使います: ${err.message}`);
    }
  }
  return { text: render(episode), source: "テンプレート" };
}

// Xの文字数カウント(URLは一律23、日本語・絵文字は2、半角英数などは1)
function weightedLength(text) {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, "");
  const urlCount = (text.match(/https?:\/\/\S+/g) || []).length;
  let length = urlCount * 23;
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0);
    const light =
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    length += light ? 1 : 2;
  }
  return length;
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// OAuth 1.0a (HMAC-SHA1) の Authorization ヘッダを組み立てる。
// JSONボディは署名対象に含めない仕様なので、oauth_* パラメータだけで署名する。
function oauthHeader(method, url) {
  const params = {
    oauth_consumer_key: CREDENTIALS.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: CREDENTIALS.token,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const baseString = [method, percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(CREDENTIALS.consumerSecret)}&${percentEncode(
    CREDENTIALS.tokenSecret
  )}`;
  params.oauth_signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  return (
    "OAuth " +
    Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(params[k])}"`)
      .join(", ")
  );
}

async function postToX() {
  const episode = pickEpisode();
  const { text, source } = await buildPost(episode);
  const length = weightedLength(text);

  if (length > 280) {
    throw new Error(`文字数オーバー(${length}/280): ${episode.title}`);
  }

  if (DRY_RUN) {
    console.log(`--- [DRY RUN] ${episode.title} / ${source} (${length}/280) ---`);
    console.log(text);
    return;
  }

  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: oauthHeader("POST", url),
    },
    body: JSON.stringify({ text }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`X投稿失敗: ${res.status} ${JSON.stringify(data)}`);
  }

  console.log(`投稿成功: ${episode.title} / ${source} (post id: ${data.data.id})`);
}

module.exports = { availableEpisodes, render, composeAiPost, weightedLength };

if (require.main === module) {
  postToX().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
