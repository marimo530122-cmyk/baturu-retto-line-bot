// その日のトレンドから「飲み会ネタとして自然に絡められて、触れても安全な話題」を1つ選ぶ。
// 集める(Google Trends RSS) → Jevで全件を並列にふるい分け → 一番相性のいいものを返す。
// 何か失敗したら null を返し、x_broadcast.js は普段どおりの投稿をする。
//
// Jevの役割は「判定」だけ。トレンドを見つけるのはRSS、投稿文を書くのはClaude。

const TREND_RSS_URL =
  process.env.TREND_RSS_URL || "https://trends.google.co.jp/trending/rss?geo=JP";
const MAX_TRENDS = 20;
// 相性スコア(0〜3)がこれ以上のトレンドだけ使う
const MIN_FIT_SCORE = Number(process.env.TREND_MIN_FIT_SCORE || "2");
// 不謹慎(災害・事故・訃報など)の確率がこれ以上なら除外。便乗炎上を避けるため厳しめ
const MAX_SENSITIVE = 0.3;
// 特定の人物・企業が主役の確率がこれ以上なら除外(投稿で実名を出さないルールと両立しないため)
const MAX_NAMED_PARTY = 0.5;

const TREND_QUESTIONS = {
  sensitive: {
    type: "noul",
    instructions:
      "The `trend` is about a disaster, accident, death, crime, illness, war, politics, a scandal or another topic where a lighthearted post would be insensitive.",
  },
  named_party: {
    type: "noul",
    instructions:
      "The `trend` is mainly about one specific real person, celebrity, company, brand or product, so a post could not mention it without naming them.",
  },
  fit: {
    type: "score",
    instructions:
      "How naturally could a lighthearted post about drinking parties, party punishment games or splitting the bill mention the `trend` without naming any real person or company?",
    criteria: [
      "No natural connection; mentioning it would feel forced.",
      "A weak connection that needs a stretch.",
      "A clear connection, such as a season, weather, holiday or event people talk about over drinks.",
      "An obvious connection: the trend is itself about gatherings, drinking parties, year-end parties or similar.",
    ],
  },
};

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// Google Trends の RSS から { title, news: [見出し...] } の配列を取り出す
function parseTrendsRss(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items
    .map((item) => {
      const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const news = [...item.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)]
        .map((m) => decodeXml(m[1]))
        .slice(0, 3);
      return title ? { title: decodeXml(title), news } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_TRENDS);
}

async function fetchTrends() {
  const res = await fetch(TREND_RSS_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`トレンド取得に失敗: ${res.status}`);
  return parseTrendsRss(await res.text());
}

// 1件のトレンドをJevで判定する。質問3つは1リクエストにまとめる
async function judgeTrend(trend, jevAsk) {
  const answers = await jevAsk({ trend: trend.title, related_news: trend.news }, TREND_QUESTIONS);
  return {
    ...trend,
    sensitive: answers.sensitive.noul,
    namedParty: answers.named_party.noul,
    fit: answers.fit.score,
  };
}

// 使えるトレンドを1つ選ぶ。候補なし・失敗時は null
async function pickTrend(jevAsk) {
  try {
    const trends = await fetchTrends();
    // トレンドごとに独立した判定なので並列に投げる(1件数百トークン、全部で1円未満)
    const judged = await Promise.all(trends.map((t) => judgeTrend(t, jevAsk)));
    const usable = judged
      .filter(
        (t) => t.sensitive < MAX_SENSITIVE && t.namedParty < MAX_NAMED_PARTY && t.fit >= MIN_FIT_SCORE
      )
      .sort((a, b) => b.fit - a.fit);
    console.log(
      `トレンド判定: ${trends.length}件中${usable.length}件が使用可` +
        (usable[0] ? ` → 「${usable[0].title}」(相性${usable[0].fit.toFixed(1)})` : "")
    );
    return usable[0] || null;
  } catch (err) {
    console.warn(`トレンドは使わずに投稿します: ${err.message}`);
    return null;
  }
}

module.exports = { parseTrendsRss, pickTrend, TREND_QUESTIONS };
