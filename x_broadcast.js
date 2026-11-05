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

const episodes = JSON.parse(
  fs.readFileSync(path.join(__dirname, "x_episodes.json"), "utf-8")
);

// 画像は1投稿1枚まで。x_images/ に置き、エピソードの "image" にパスを書く。
// "image_type": "photo"(本人の実物写真) / "composite"(本人の写真をもとにした合成のイメージ画像)
const IMAGE_TYPES = ["photo", "composite"];
const IMAGE_MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Xの画像の上限(5MB)
// 合成画像を当時の実物写真だと誤解させないため、プログラム側で必ず付ける(【PR】と同じ考え方)
const IMAGE_NOTE = "※画像はイメージです";

function isStory(episode) {
  return episode.kind === "story";
}

// リンク先: 実話はブログ記事のURLを直接持つ。それ以外は URL_VARS の名前で指定する
function linkUrl(episode) {
  return isStory(episode) ? episode.url : URL_VARS[episode.link];
}

// リンク先URLが未設定のテンプレート(三口割り・アフィリエイト等)はスキップする
function availableEpisodes() {
  return episodes.filter((e) => (e.requires || []).every((key) => URL_VARS[key]));
}

// 実話は x_episodes.json に並んだ順に、1日1本ずつ出す(続き物なので順番どおり)。
// 1本目を出す日(日本時間)。この日より前は投稿しない。最後まで行ったら1本目に戻る
const STORY_START_DATE = "2026-11-07";

// 1本目の日から何日目か(1本目の日=0)。日付の区切りは日本時間の朝9時(=世界標準時の0時)。
// 17:30の自動実行はGitHub側で数時間遅れることがあり(夜中の1時台になった例あり)、
// 日本時間の0時で区切ると遅れた日に1本飛ばしてしまうため
function daysSinceStart(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return Math.round((Date.parse(today) - Date.parse(STORY_START_DATE)) / 86400000);
}

// 投稿するのは吉○水産時代の実話(kind: "story")だけ。既存の宣伝ネタ(罰ゲームルーレット等)は
// x_episodes.json に入っていても選ばない(方針: 実話100%)。実話が0本の日・1本目の日より前は null(投稿しない)
function pickEpisode(now = new Date()) {
  const stories = availableEpisodes().filter(isStory);
  const day = daysSinceStart(now);
  if (!stories.length || day < 0) return null;
  return stories[day % stories.length];
}

// 会社名は実名を出さず「吉○水産」(1文字を○で伏せる)と書く。
// 種に実名があっても、投稿文では必ず置き換える。置き換えた後も実名の一部が残る文面は使わない
const SHOP_ALIAS = "吉○水産";
const SHOP_REAL_NAME = /吉川/;
function maskShopName(text) {
  return text.replace(/吉川水産/g, SHOP_ALIAS);
}

// 実話シリーズの共通タグ。丸印「○」だとXがタグをそこで切ってしまうため、タグだけ漢数字の「〇」を使う
// (本文中の表記は「吉○水産」のまま)。タグは1投稿につき2個まで: 共通タグ + エピソードごとに1個まで
const STORY_TAG = "#吉〇水産の実話";
const MAX_STORY_TAGS = 2;
function storyHashtags(episode) {
  const extra = String(episode.hashtags || "").split(/\s+/).filter((t) => t && t !== STORY_TAG);
  return [STORY_TAG, ...extra].slice(0, MAX_STORY_TAGS).join(" ");
}

// 画像ファイルの場所と種類。指定が無い・見つからない場合は null(文字だけで投稿する)
function resolveImage(episode) {
  if (!episode.image) return null;
  const file = path.join(__dirname, episode.image);
  if (!fs.existsSync(file)) {
    console.warn(`画像が見つからないため文字だけで投稿します: ${episode.image}`);
    return null;
  }
  return { file, type: episode.image_type };
}

// ステマ規制(景品表示法)対応: 広告・アフィリエイトを含む投稿は必ず先頭で明示する
function withAdLabel(episode, text) {
  return episode.ad ? `【PR】${text}` : text;
}

function withImageNote(image, body) {
  return image && image.type === "composite" ? `${body}\n${IMAGE_NOTE}` : body;
}

function render(episode, image = null) {
  if (isStory(episode)) return composeAiPost(episode, episode.text, image);
  let text = episode.text;
  for (const [key, value] of Object.entries(URL_VARS)) {
    if (value) text = text.replaceAll(`{{${key}}}`, value);
  }
  return withAdLabel(episode, withImageNote(image, text));
}

// AIが書くのは本文だけ。URL・ハッシュタグ・【PR】・画像のイメージ表記はプログラム側で必ず付ける
// (AIにURLを書かせると存在しないリンクや表記漏れが起きうるため)
function composeAiPost(episode, body, image = null) {
  const lead = isStory(episode) ? "▶ 続きはブログで" : "▶";
  const tags = isStory(episode) ? storyHashtags(episode) : episode.hashtags;
  const suffix = `\n\n${lead} ${linkUrl(episode)}\n\n${tags}`;
  const text = withAdLabel(episode, withImageNote(image, body) + suffix);
  return isStory(episode) ? maskShopName(text) : text;
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
- 添付画像が合成のイメージ画像のときは、「当時の写真」「実際の写真」など本物の写真だと思わせる書き方をしない
- 参考投稿をそのまま使わず、毎回違う切り口・状況で書く`;

// 実話エピソード用。ブログに書いた魚屋の実話から、一番いい一場面だけを切り取る
const STORY_SYSTEM_PROMPT = `あなたは現役の魚屋(48歳)本人として、自分のブログに書いた${SHOP_ALIAS}時代(30代のころ)の実話をX(旧Twitter)に投稿します。
与えられた「場面の種」から、一番いい一場面だけを切り取った投稿の「本文だけ」を日本語で書いてください。

ルール:
- 本文のみを出力する。前置き・説明・カギ括弧での囲みは不要
- 物語全体の要約にしない。一番いい一場面だけを、その場にいるように書き、続きが気になるところで止める
- 1行目は、セリフか現場の情景から始める(読み手の手を止めるため。「今日は〜の話」のような前置きから入らない)
- 本人の一人称で、素直な話し言葉で書く。指定された文字数以内、絵文字は0〜1個
- 種に書かれていない出来事・数字・セリフ・登場人物を足さない(実話なので話を盛らない)
- 会社名は「${SHOP_ALIAS}」と表記する。実名では書かない(種に実名があっても「${SHOP_ALIAS}」に置き換える)
- それ以外の実在の人物名・企業名・店名は出さない
- URL、ハッシュタグ、【PR】などの広告表記は書かない(後でプログラムが付け足す)
- イッキ飲み、飲酒の強要、未成年の飲酒を連想させる内容にしない
- 添付画像が合成のイメージ画像のときは、「当時の写真」「実際の写真」など本物の写真だと思わせる書き方をしない
- 参考投稿をそのまま使わず、毎回違う書き出しで書く`;

const IMAGE_DESCRIPTIONS = {
  photo: "本人の仕事の実物写真",
  composite: "本人の写真をもとに作った合成のイメージ画像(当時の実物写真ではない)",
};

function unwrapQuotes(text) {
  const m = text.match(/^「([^「」]*)」$/) || text.match(/^『([^『』]*)』$/) || text.match(/^"([^"]*)"$/);
  return m ? m[1].trim() : text;
}

async function generateAiBody(episode, maxChars, image = null) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);
  const imageLine = image ? `添付画像: ${IMAGE_DESCRIPTIONS[image.type]}\n` : "";
  const content = isStory(episode)
    ? `日付: ${today}\n` +
      imageLine +
      `文字数: 全角${maxChars}文字以内\n\n` +
      `場面の種:\n${episode.seed}\n\n` +
      `参考投稿(このまま使わないこと):\n${episode.text}`
    : `日付: ${today}\n` +
      imageLine +
      `テーマ: ${episode.topic}\n` +
      `文字数: 全角${maxChars}文字以内\n\n` +
      `参考投稿(このまま使わないこと):\n${episode.text}`;

  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    // 安全フィルタで断られた場合に、推奨の別モデルで自動再実行させる
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: isStory(episode) ? STORY_SYSTEM_PROMPT : AI_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason !== "end_turn") {
    throw new Error(`AI生成が完了しませんでした (stop_reason: ${response.stop_reason})`);
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  // AIが本文全体をカギ括弧でくくって返したときだけ外す。
  // 「セリフ」で始まる・終わる本文の括弧は消さない(実話は1行目をセリフから書くため)
  const body = unwrapQuotes(raw);

  if (!body) throw new Error("AIの本文が空でした");
  if (/https?:\/\/|#|＃|【PR】/.test(body)) {
    throw new Error(`AIの本文にURL・ハッシュタグ・PR表記が含まれていました: ${body}`);
  }
  const masked = isStory(episode) ? maskShopName(body) : body;
  if (isStory(episode) && SHOP_REAL_NAME.test(masked)) {
    throw new Error(`AIの本文に実名の一部が残っていました(会社名は「${SHOP_ALIAS}」と書く決まり)`);
  }
  return masked;
}

// その日の投稿文を決める。AIが使えればAI版、ダメなら固定文面
// (Xは日本語1文字を2と数え、上限280。実話は「約140字」が目安だが、URL・ハッシュタグの分だけ短くなる)
async function buildPost(episode, image = null) {
  if (USE_AI) {
    try {
      const fixedPart = weightedLength(composeAiPost(episode, "", image));
      const maxChars = Math.min(140, Math.floor((280 - fixedPart) / 2) - 5);
      const text = composeAiPost(episode, await generateAiBody(episode, maxChars, image), image);
      if (weightedLength(text) > 280) {
        throw new Error(`AIの文面が文字数オーバー(${weightedLength(text)}/280)`);
      }
      return { text, source: "AI" };
    } catch (err) {
      console.warn(`AI生成をスキップして固定文面を使います: ${err.message}`);
    }
  }
  return { text: render(episode, image), source: "テンプレート" };
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
// JSON・multipartのボディは署名対象に含めない仕様なので、oauth_* パラメータだけで署名する。
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

// 画像をXにアップロードして media_id を返す
async function uploadImage(image) {
  const url = "https://api.x.com/2/media/upload";
  const mime = IMAGE_MIME[path.extname(image.file).toLowerCase()];
  const form = new FormData();
  form.append("media", new Blob([fs.readFileSync(image.file)], { type: mime }), path.basename(image.file));
  form.append("media_category", "tweet_image");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url) },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data || !data.data.id) {
    const err = new Error(`画像アップロード失敗: ${res.status} ${JSON.stringify(data)}`);
    err.status = res.status;
    throw err;
  }
  return data.data.id;
}

async function postToX() {
  if (!DRY_RUN && Object.values(CREDENTIALS).some((v) => !v)) {
    throw new Error(
      "X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET が設定されていません。"
    );
  }

  const episode = pickEpisode();
  if (!episode) {
    console.log(
      daysSinceStart() < 0
        ? `実話の投稿は ${STORY_START_DATE} から始まるため、今日は投稿しません`
        : "投稿する実話エピソードがまだ0本のため、今日は投稿しません(x_episodes.json に kind: \"story\" を追加してください)"
    );
    return;
  }
  let image = resolveImage(episode);
  let { text, source } = await buildPost(episode, image);
  const length = weightedLength(text);

  if (length > 280) {
    throw new Error(`文字数オーバー(${length}/280): ${episode.title}`);
  }

  if (DRY_RUN) {
    console.log(`--- [DRY RUN] ${episode.title} / ${source} (${length}/280) ---`);
    if (image) console.log(`[画像] ${episode.image} (${IMAGE_DESCRIPTIONS[image.type]})`);
    console.log(text);
    return;
  }

  let mediaId = null;
  if (image) {
    try {
      mediaId = await uploadImage(image);
    } catch (err) {
      // 残高不足(402)・認証エラー(401/403)は本文の投稿も通らないので、そのまま失敗にする
      if ([401, 402, 403].includes(err.status)) throw err;
      console.warn(`${err.message} → 文字だけで投稿します`);
      text = text.replace(`\n${IMAGE_NOTE}`, "");
      image = null;
    }
  }

  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: oauthHeader("POST", url),
    },
    body: JSON.stringify(mediaId ? { text, media: { media_ids: [mediaId] } } : { text }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`X投稿失敗: ${res.status} ${JSON.stringify(data)}`);
  }

  console.log(
    `投稿成功: ${episode.title} / ${source}${mediaId ? " / 画像つき" : ""} (post id: ${data.data.id})`
  );
}

// x_episodes.json の書き方と画像ファイルを点検する(node x_broadcast.js --check)。
// シロが実話や画像を追加したときに、投稿日より前に間違いに気づけるようにするため
function checkEpisodes() {
  const errors = [];
  episodes.forEach((e, i) => {
    const name = `${i + 1}番目「${e.title || "(タイトルなし)"}」`;
    const need = (key) => {
      if (typeof e[key] !== "string" || !e[key].trim()) errors.push(`${name}: "${key}" がありません`);
    };
    ["title", "text"].forEach(need);
    if (!isStory(e)) need("hashtags"); // 実話は共通タグ「#吉〇水産の実話」をプログラムが付けるので省略してよい
    if (isStory(e)) {
      need("seed");
      if (typeof e.url !== "string" || !/^https:\/\/\S+$/.test(e.url)) {
        errors.push(`${name}: "url" にブログ記事のURL(https://〜)を書いてください`);
      }
      if (/https?:\/\/|#|＃|【PR】/.test(e.text || "")) {
        errors.push(`${name}: 実話の "text" には本文だけを書いてください(URL・ハッシュタグはプログラムが付けます)`);
      }
      // 「吉川水産」は投稿時に自動で「吉○水産」に置き換わる。それ以外の形で実名が残るものだけ知らせる
      const extraTags = String(e.hashtags || "").split(/\s+/).filter((t) => t && t !== STORY_TAG);
      if (extraTags.length > MAX_STORY_TAGS - 1) {
        errors.push(`${name}: "hashtags" は1個までです(共通タグ「${STORY_TAG}」はプログラムが付けるので、合わせて2個まで)`);
      }
      if (extraTags.some((t) => !/^[#＃]/.test(t))) {
        errors.push(`${name}: "hashtags" は # から始めてください`);
      }
      if (/○|吉川/.test(e.hashtags || "")) {
        errors.push(`${name}: タグに「○」や実名は使えません(タグでは漢数字の「〇」を使います。例: ${STORY_TAG})`);
      }
      if (SHOP_REAL_NAME.test(maskShopName(`${e.text || ""}${e.hashtags || ""}`))) {
        errors.push(`${name}: "text" か "hashtags" に実名の一部が残っています(会社名は「${SHOP_ALIAS}」と書いてください)`);
      }
    } else {
      need("topic");
      if (!(e.link in URL_VARS)) errors.push(`${name}: "link" は ${Object.keys(URL_VARS).join(" / ")} のどれかです`);
    }
    if (e.kind !== undefined && e.kind !== "story") errors.push(`${name}: "kind" は "story" だけです`);
    if (e.image !== undefined) {
      const file = path.join(__dirname, String(e.image));
      if (!IMAGE_TYPES.includes(e.image_type)) {
        errors.push(`${name}: "image_type" は "photo"(実物写真)か "composite"(合成のイメージ画像)です`);
      }
      if (!IMAGE_MIME[path.extname(String(e.image)).toLowerCase()]) {
        errors.push(`${name}: 画像は .jpg / .jpeg / .png / .webp にしてください: ${e.image}`);
      } else if (!fs.existsSync(file)) {
        errors.push(`${name}: 画像ファイルが見つかりません(ファイル名の打ち間違いに注意): ${e.image}`);
      } else if (fs.statSync(file).size > MAX_IMAGE_BYTES) {
        errors.push(`${name}: 画像が5MBを超えています: ${e.image}`);
      }
    }
    // 固定文面(AIが失敗した日に使う)が280以内か。リンク先が未設定のものは投稿されないので数えない
    if (typeof e.text === "string" && (e.requires || []).every((k) => URL_VARS[k]) && (!isStory(e) || e.url)) {
      const image = e.image && IMAGE_TYPES.includes(e.image_type) ? { type: e.image_type } : null;
      const len = weightedLength(render(e, image));
      if (len > 280) errors.push(`${name}: 固定文面が長すぎます(${len}/280)`);
    }
  });

  const stories = episodes.filter(isStory).length;
  console.log(`エピソード ${episodes.length}本(実話 ${stories}本・既存の宣伝ネタ ${episodes.length - stories}本は投稿に使いません)`);
  if (errors.length) {
    errors.forEach((msg) => console.error(`NG ${msg}`));
    return false;
  }
  console.log("OK すべて問題ありません");
  return true;
}

module.exports = { availableEpisodes, pickEpisode, render, composeAiPost, weightedLength, checkEpisodes, postToX };

if (require.main === module) {
  if (process.argv.includes("--check")) {
    process.exit(checkEpisodes() ? 0 : 1);
  }
  postToX().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
