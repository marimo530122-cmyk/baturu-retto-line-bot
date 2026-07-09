const fs = require("fs");
const path = require("path");

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAME_URL = process.env.GAME_URL || "https://marimo530122-cmyk.github.io/baturu-retto/";

if (!ACCESS_TOKEN) {
  console.error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません。");
  process.exit(1);
}

const episodes = JSON.parse(
  fs.readFileSync(path.join(__dirname, "episodes.json"), "utf-8")
);

function pickEpisode() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const now = new Date();
  const dayOfYear = Math.floor((now - start) / 86400000);
  return episodes[dayOfYear % episodes.length];
}

async function broadcast() {
  const episode = pickEpisode();
  const text = episode.text.replaceAll("{{GAME_URL}}", GAME_URL);

  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE broadcast failed: ${res.status} ${body}`);
  }

  console.log(`配信成功: ${episode.title}`);
}

broadcast().catch((err) => {
  console.error(err);
  process.exit(1);
});
