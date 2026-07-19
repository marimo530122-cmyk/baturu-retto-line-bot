const fs = require("fs");
const path = require("path");

const PAGE_ID = process.env.FB_PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const GAME_URL = process.env.GAME_URL || "https://marimo530122-cmyk.github.io/baturu-retto/";

if (!PAGE_ID || !PAGE_ACCESS_TOKEN) {
  console.error("FB_PAGE_ID または FB_PAGE_ACCESS_TOKEN が設定されていません。");
  process.exit(1);
}

const episodes = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fb_episodes.json"), "utf-8")
);

function pickEpisode() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const now = new Date();
  const dayOfYear = Math.floor((now - start) / 86400000);
  return episodes[dayOfYear % episodes.length];
}

async function postToFacebook() {
  const episode = pickEpisode();
  const message = episode.text.replaceAll("{{GAME_URL}}", GAME_URL);

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PAGE_ID}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        access_token: PAGE_ACCESS_TOKEN,
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Facebook投稿失敗: ${JSON.stringify(data)}`);
  }

  console.log(`投稿成功: ${episode.title} (post id: ${data.id})`);
}

postToFacebook().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
