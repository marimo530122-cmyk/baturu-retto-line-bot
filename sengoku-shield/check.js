// 接続チェック: .env に書いた鍵で、Claude・Jev・LINE・Twilio・公開URLにつながるかを確かめる
//   npm run check
// 鍵そのものは画面に出さない。お金のかかる操作(電話をかける・LINEを送る)はしない。

const crypto = require("crypto");

const env = process.env;
const results = [];

function row(name, status, detail) {
  results.push({ name, status, detail });
  const mark = { ok: "○", ng: "×", skip: "-" }[status];
  console.log(`${mark} ${name}${detail ? `: ${detail}` : ""}`);
}

async function checkRequired() {
  const missing = ["SHIELD_PUBLIC_URL", "SHIELD_APP_TOKEN", "TWILIO_AUTH_TOKEN"].filter((k) => !env[k]);
  if (missing.length) {
    row("サーバーの起動に必要な設定", "ng", `${missing.join("・")} が空です`);
    if (!env.SHIELD_APP_TOKEN) {
      console.log(`   SHIELD_APP_TOKEN の候補(これをそのまま使えます): ${crypto.randomBytes(18).toString("base64url")}`);
    }
  } else {
    row("サーバーの起動に必要な設定", "ok");
  }
}

async function checkPublicUrl() {
  if (!env.SHIELD_PUBLIC_URL) return row("公開URL", "skip", "SHIELD_PUBLIC_URL が空");
  try {
    const res = await fetch(`${env.SHIELD_PUBLIC_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    if (res.ok && text.trim() === "ok") row("公開URL", "ok", "外からサーバーに届きます");
    else row("公開URL", "ng", `応答が想定と違います(${res.status})。サーバー(npm run start:env)とトンネルが動いているか確認`);
  } catch (err) {
    row("公開URL", "ng", `つながりません(${err.message})。サーバーとトンネルが動いているか確認`);
  }
}

async function checkClaude() {
  if (!env.ANTHROPIC_API_KEY) return row("Claude(AIの返事)", "skip", "ANTHROPIC_API_KEY が空(AIは決まった言い方で返事します)");
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ timeout: 15000, maxRetries: 0 });
    await client.models.list({ limit: 1 });
    row("Claude(AIの返事)", "ok");
  } catch (err) {
    const Anthropic = require("@anthropic-ai/sdk");
    if (err instanceof Anthropic.AuthenticationError) row("Claude(AIの返事)", "ng", "APIキーが違います");
    else if (err instanceof Anthropic.PermissionDeniedError) row("Claude(AIの返事)", "ng", "このキーには権限がありません");
    else if (err instanceof Anthropic.APIConnectionError) row("Claude(AIの返事)", "ng", `つながりません(${err.message})`);
    else if (err instanceof Anthropic.APIError) row("Claude(AIの返事)", "ng", `APIエラー ${err.status}`);
    else row("Claude(AIの返事)", "ng", `つながりません(${err.message})`);
  }
}

async function checkJev() {
  if (!env.TYPESAFE_API_KEY) return row("Jev(TypeSafe)", "skip", "TYPESAFE_API_KEY が空(正規表現の判定だけで動きます)");
  const base = env.TYPESAFE_API_BASE_URL || "https://api.typesafe.ai";
  try {
    const res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: JSON.stringify({
        model: env.JEV_MODEL || "jev-1.13.0",
        state: { transcript: [{ speaker: "caller", text: "市役所です。還付金があるので、今日中にATMへ行ってください。" }] },
        questions: {
          verdict: {
            type: "choice",
            instructions: "この電話は特殊詐欺の手口に近いか判定してください。",
            criteria: { scam_likely: "詐欺の手口に近い", legitimate: "普通の用件" },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    if (!res.ok) return row("Jev(TypeSafe)", "ng", `APIエラー ${res.status}: ${body.slice(0, 160)}`);
    let choice = null;
    try {
      choice = JSON.parse(body)?.answers?.verdict?.choice;
    } catch {}
    if (choice) row("Jev(TypeSafe)", "ok", `試しの判定: ${choice}(詐欺の例文なので scam_likely が正解)`);
    else row("Jev(TypeSafe)", "ng", `応答の形が想定と違います: ${body.slice(0, 160)}(lib/jev.js の読み取り方を直す必要があります)`);
  } catch (err) {
    row("Jev(TypeSafe)", "ng", `つながりません(${err.message})`);
  }
}

async function checkLine() {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return row("LINE(家族への知らせ)", "skip", "LINE_CHANNEL_ACCESS_TOKEN が空");
  try {
    const res = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return row("LINE(家族への知らせ)", "ng", `アクセストークンが違うようです(${res.status})`);
    const info = await res.json();
    const secretNote = env.LINE_CHANNEL_SECRET ? "" : "(LINE_CHANNEL_SECRET が空なので、家族の登録は受け付けません)";
    row("LINE(家族への知らせ)", env.LINE_CHANNEL_SECRET ? "ok" : "ng", `公式アカウント「${info.displayName}」${secretNote}`);
    if (env.SHIELD_PUBLIC_URL) console.log(`   LINE Developers の Webhook URL は ${env.SHIELD_PUBLIC_URL.replace(/\/$/, "")}/line/webhook にしてください`);
  } catch (err) {
    row("LINE(家族への知らせ)", "ng", `つながりません(${err.message})`);
  }
}

async function checkTwilio() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return row("Twilio(家族への自動電話)", "skip", "TWILIO_ACCOUNT_SID か TWILIO_AUTH_TOKEN が空");
  }
  try {
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}.json`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return row("Twilio(家族への自動電話)", "ng", `Account SID か Auth Token が違うようです(${res.status})`);
    const callerNote = env.SHIELD_CALLER_ID ? `発信番号 末尾${env.SHIELD_CALLER_ID.slice(-4)}` : "SHIELD_CALLER_ID(発信番号)が空";
    row("Twilio(家族への自動電話)", env.SHIELD_CALLER_ID ? "ok" : "ng", callerNote);
    if (env.SHIELD_PUBLIC_URL) {
      const base = env.SHIELD_PUBLIC_URL.replace(/\/$/, "");
      console.log(`   Twilio の番号の着信先は ${base}/voice/incoming、状態の通知先は ${base}/voice/status にしてください`);
    }
  } catch (err) {
    row("Twilio(家族への自動電話)", "ng", `つながりません(${err.message})`);
  }
}

(async () => {
  console.log("戦国シールド 接続チェック\n");
  await checkRequired();
  await checkPublicUrl();
  await checkClaude();
  await checkJev();
  await checkLine();
  await checkTwilio();
  const ng = results.filter((r) => r.status === "ng").length;
  console.log(`\n${ng ? `× が ${ng} 件あります。上の説明を見て直してください。` : "問題はありません(- は未設定で、その機能を使わないだけです)。"}`);
  process.exitCode = ng ? 1 : 0;
})();
