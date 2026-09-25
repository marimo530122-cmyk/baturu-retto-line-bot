// Jev(TypeSafe)による2段目の判定: 通話全体の「文脈」から詐欺らしさを判定する
//
// 正規表現(lib/detector.js)は決まった言い回ししか拾えないので、
// 言い換え(「お金が戻ってくる手続き」等)の見逃しと、
// 単語だけの誤検知(本物の宅配業者が「今日中に」と言った等)をJevで補う。
//
// - Twilio 経由の通話では、通話終了後の1回だけ呼ぶ(通話中に呼ぶとTwilioの15秒タイムアウトに響くため)。
// - スマホ連動(lib/realtime.js)では、発話ごとに短いタイムアウトで呼ぶ。
// - TYPESAFE_API_KEY が無い・失敗したときは null を返し、正規表現の判定だけで動く。
// - API形式は realtime-minutes/lib/classify/jevClassifier.ts と同じ POST /v1/systemone。

const VERDICTS = {
  scam_likely: "詐欺の手口にかなり近い(お金・カード・個人情報を狙う流れがある)",
  suspicious: "怪しい点はあるが、はっきりとは言えない",
  legitimate: "普通の用件(宅配・知人・正規の営業など)に見える",
  unclear: "会話が短い・聞き取れないなどで判断できない",
};

const RISK_LEVELS = [
  "危険なし。普通の用件",
  "低い。念のため記録しておく程度",
  "中程度。家族に共有しておきたい",
  "高い。典型的な詐欺の流れで、すぐ注意喚起すべき",
];

const INSTRUCTIONS =
  "これは詐欺電話対策の自動応答システムが受けた電話の文字起こしです。" +
  "caller が電話をかけてきた相手、shield が自動応答の発言です(shield の発言は判定材料にしない)。" +
  "相手の発言の流れから、この電話が特殊詐欺の手口にどれだけ近いかを判定してください。" +
  "特定の単語が出たかどうかではなく、お金・カード・個人情報を渡す方向へ誘導しているかを重視してください。";

function enabled() {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

async function judgeCall(history, { timeoutMs = 15_000 } = {}) {
  if (!enabled()) return null;
  const baseUrl = process.env.TYPESAFE_API_BASE_URL || "https://api.typesafe.ai";
  const model = process.env.JEV_MODEL || "jev-1.13.0";
  const transcript = history.map((h) => ({ speaker: h.role, text: h.text }));
  if (!transcript.some((t) => t.speaker === "caller")) return null;

  try {
    const res = await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        state: { transcript },
        questions: {
          verdict: { type: "choice", instructions: INSTRUCTIONS, criteria: VERDICTS },
          risk: { type: "score", instructions: INSTRUCTIONS, criteria: RISK_LEVELS },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Jev API error: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const answers = (await res.json())?.answers ?? {};

    const verdict = Object.hasOwn(VERDICTS, answers?.verdict?.choice) ? answers.verdict.choice : null;
    const rawRisk = Number(answers?.risk?.score);
    const risk = Number.isFinite(rawRisk) ? Math.min(3, Math.max(0, Math.round(rawRisk))) : null;
    if (verdict === null && risk === null) throw new Error("Jev の応答に verdict も risk も無い");
    return { verdict, risk, model };
  } catch (err) {
    console.error("[jev] 判定に失敗したので正規表現の判定だけを使います:", err.message);
    return null;
  }
}

// AIが代わりに話している間の、相手の様子(聞き出しを続けるか、なだめてつなぎ止めるか)
const ENGAGEMENT = {
  cooperating: "相手は話を続けていて、名前・振込先・日時などを話している",
  suspicious: "相手が怪しみ始めている、いら立っている、話が進まないことを責めている",
  leaving: "相手が電話を切ろうとしている、かけ直すと言っている",
};

const ENGAGEMENT_INSTRUCTIONS =
  "これは、詐欺の疑いがある電話にAIが代わりに応対している会話の文字起こしです。" +
  "caller が電話をかけてきた相手、shield がAIの発言です。最後の caller の発言を中心に、相手の今の様子を選んでください。";

async function judgeEngagement(history, { timeoutMs = 1500 } = {}) {
  if (!enabled()) return null;
  const transcript = history.slice(-8).map((h) => ({ speaker: h.role, text: h.text }));
  if (!transcript.some((t) => t.speaker === "caller")) return null;
  try {
    const res = await fetch(`${process.env.TYPESAFE_API_BASE_URL || "https://api.typesafe.ai"}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
      body: JSON.stringify({
        model: process.env.JEV_MODEL || "jev-1.13.0",
        state: { transcript },
        questions: { engagement: { type: "choice", instructions: ENGAGEMENT_INSTRUCTIONS, criteria: ENGAGEMENT } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Jev API error: ${res.status}`);
    const choice = (await res.json())?.answers?.engagement?.choice;
    return Object.hasOwn(ENGAGEMENT, choice) ? choice : null;
  } catch (err) {
    console.error("[jev] 相手の様子の判定に失敗(言葉からの判定だけを使います):", err.message);
    return null;
  }
}

// 正規表現の判定とJevの判定を合わせて、最終的な疑いレベルを決める
// - どちらかが「高」なら高(見逃しを減らす)
// - 正規表現が「中」でも、Jevが普通の用件と判定したら「低」に下げる(誤検知を減らす)
function combine(detection, jev) {
  if (!jev) return { level: detection.level, label: detection.label, by: "regex" };
  const jevHigh = jev.verdict === "scam_likely" || jev.risk === 3;
  const jevLegit = jev.verdict === "legitimate" || jev.risk === 0;

  if (detection.level === "high" || jevHigh) {
    return { level: "high", label: "詐欺の疑い:高", by: jevHigh ? "regex+jev" : "regex" };
  }
  if (detection.level === "medium" && jevLegit) {
    return { level: "low", label: "詐欺の疑い:低", by: "regex+jev" };
  }
  if (detection.level !== "medium" && (jev.verdict === "suspicious" || jev.risk === 2)) {
    return { level: "medium", label: "詐欺の疑い:中", by: "jev" };
  }
  return { level: detection.level, label: detection.label, by: "regex+jev" };
}

module.exports = { judgeCall, judgeEngagement, combine, enabled, VERDICTS, ENGAGEMENT };
