const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// DRY_RUN=1 のときはXに投稿せず、投稿予定の文面を表示するだけ
const DRY_RUN = process.env.DRY_RUN === "1";

const URL_VARS = {
  GAME_URL: process.env.GAME_URL || "https://marimo530122-cmyk.github.io/baturu-retto/",
  MIKUCHIWARI_URL: process.env.MIKUCHIWARI_URL,
  AFFILIATE_URL: process.env.AFFILIATE_URL,
  SUPPORT_URL: process.env.SUPPORT_URL,
};

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

function render(episode) {
  let text = episode.text;
  for (const [key, value] of Object.entries(URL_VARS)) {
    if (value) text = text.replaceAll(`{{${key}}}`, value);
  }
  // ステマ規制(景品表示法)対応: 広告・アフィリエイトを含む投稿は必ず先頭で明示する
  if (episode.ad) text = `【PR】${text}`;
  return text;
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
  const text = render(episode);
  const length = weightedLength(text);

  if (length > 280) {
    throw new Error(`文字数オーバー(${length}/280): ${episode.title}`);
  }

  if (DRY_RUN) {
    console.log(`--- [DRY RUN] ${episode.title} (${length}/280) ---`);
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

  console.log(`投稿成功: ${episode.title} (post id: ${data.data.id})`);
}

module.exports = { availableEpisodes, render, weightedLength };

if (require.main === module) {
  postToX().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
