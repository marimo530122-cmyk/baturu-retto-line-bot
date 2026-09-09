const fs = require("fs");
const path = require("path");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NOTIFY_LINE_TOKEN = process.env.NOTIFY_LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!NOTIFY_LINE_TOKEN) {
  console.error("NOTIFY_LINE_CHANNEL_ACCESS_TOKEN が設定されていません。");
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, "discovered_repos.json");
const usedRepos = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"))
  : [];

const SEARCH_TOPICS = [
  "developer-tools",
  "cli",
  "productivity",
  "automation",
  "ai-tools",
  "self-hosted",
  "open-source",
];

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

async function githubFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function findCandidate() {
  const topic = SEARCH_TOPICS[Math.floor(Math.random() * SEARCH_TOPICS.length)];
  const query = `topic:${topic} stars:50..3000 pushed:>${daysAgoISO(90)}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    query
  )}&sort=stars&order=desc&per_page=30`;

  const data = await githubFetch(url);
  const candidate = data.items.find((repo) => !usedRepos.includes(repo.full_name));

  if (!candidate) {
    throw new Error(`候補が見つかりませんでした（topic: ${topic}）。`);
  }
  return candidate;
}

async function fetchReadmeExcerpt(repo) {
  try {
    const data = await githubFetch(`https://api.github.com/repos/${repo.full_name}/readme`);
    return Buffer.from(data.content, "base64").toString("utf-8").slice(0, 3000);
  } catch {
    return "";
  }
}

async function generateDraftWithClaude(repo, readme) {
  const prompt = `あなたはX(Twitter)のツリー投稿を作る編集者です。
以下のGitHubリポジトリを「1日1個、隠れた名作ツールを紹介する」企画用に、日本語で4投稿のツリー下書きを作ってください。

構成:
1投稿目: フックになる一言＋何のツールか一言（煽りすぎない）
2投稿目: 具体的に何ができるか、誰向けか
3投稿目: 導入方法や使い方の要点
4投稿目: リポジトリURLとまとめ

制約:
- 各投稿は140字以内
- README・説明文に実際に書かれている内容だけを使い、誇張や推測で機能を足さない
- 実在しないツールや他社製品名を勝手に持ち出さない

リポジトリ名: ${repo.full_name}
説明: ${repo.description || "なし"}
スター数: ${repo.stargazers_count}
URL: ${repo.html_url}

README抜粋:
${readme || "(取得できませんでした)"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

function generateTemplateDraft(repo) {
  return `【今日の発掘リポジトリ（テンプレート下書き）】
${repo.full_name}
★${repo.stargazers_count}

${repo.description || "(説明なし)"}

${repo.html_url}

※ANTHROPIC_API_KEY未設定のため自動生成をスキップしました。内容を確認し、自分の言葉でツリーに仕上げてください。`;
}

async function sendLineBroadcast(text) {
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NOTIFY_LINE_TOKEN}`,
    },
    body: JSON.stringify({
      messages: [{ type: "text", text: text.slice(0, 5000) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE broadcast failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const repo = await findCandidate();
  const readme = await fetchReadmeExcerpt(repo);

  const draft = ANTHROPIC_API_KEY
    ? await generateDraftWithClaude(repo, readme)
    : generateTemplateDraft(repo);

  await sendLineBroadcast(draft);

  usedRepos.push(repo.full_name);
  fs.writeFileSync(STATE_FILE, JSON.stringify(usedRepos, null, 2));

  console.log(`下書き送信成功: ${repo.full_name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
