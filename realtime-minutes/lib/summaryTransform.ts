import { CATEGORY_LABEL, ClassifiedUtterance, Mode } from "@/lib/types";
import { analyzeKarte, candidatesEnabled, collapseGrowingUtterances, karteInsightsMarkdown } from "@/lib/karteInsights";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function meetingSummary(utterances: ClassifiedUtterance[]): string {
  const lines: string[] = ["# 議事録", "", `作成: ${new Date().toLocaleString("ja-JP")}`, ""];

  const decisions = utterances.filter((u) => u.category === "decision");
  if (decisions.length) {
    lines.push("## 決定事項");
    decisions.forEach((u) => lines.push(`- ${u.summary || u.text}`));
    lines.push("");
  }

  const todos = utterances.filter((u) => u.category === "todo");
  if (todos.length) {
    lines.push("## ToDo / 宿題");
    todos.forEach((u) => lines.push(`- [ ] ${u.summary || u.text}`));
    lines.push("");
  }

  const problems = utterances.filter((u) => u.category === "problem");
  if (problems.length) {
    lines.push("## 問題点");
    problems.forEach((u) => lines.push(`- ${u.summary || u.text}`));
    lines.push("");
  }

  const solutions = utterances.filter((u) => u.category === "solution");
  if (solutions.length) {
    lines.push("## 解決策");
    solutions.forEach((u) => lines.push(`- ${u.summary || u.text}`));
    lines.push("");
  }

  const concepts = utterances.filter((u) => u.category === "concept");
  if (concepts.length) {
    lines.push("## 概念・用語");
    concepts.forEach((u) => lines.push(`- ${u.summary || u.text}`));
    lines.push("");
  }

  lines.push("## タイムライン(全発言)");
  utterances.forEach((u) => {
    lines.push(`- \`${formatTime(u.timestamp)}\` [${CATEGORY_LABEL[u.category]}] ${u.text}`);
  });

  return lines.join("\n");
}

/**
 * 分類器の summary が「本文の先頭を切っただけ」(キー不要の簡易分類器)のときは、途中で切れて
 * 読めなくなるので本文をそのまま出す。AIが作った本当の要約ならそちらを使う。
 */
function displayText(u: ClassifiedUtterance): string {
  if (!u.summary || u.text.startsWith(u.summary)) return u.text;
  return u.summary;
}

function karteSummary(rawUtterances: ClassifiedUtterance[]): string {
  // 音声認識が同じ発言を伸ばしながら何度も確定させた分を、表示用に1つにまとめる
  const utterances = collapseGrowingUtterances(rawUtterances);
  const now = new Date();
  const lines: string[] = [
    "# 通院カルテ",
    "",
    `記録日: ${now.toLocaleDateString("ja-JP")}`,
    `作成時刻: ${now.toLocaleTimeString("ja-JP")}`,
    "",
    ...karteInsightsMarkdown(analyzeKarte(utterances, { includeCandidates: candidatesEnabled() })),
  ];

  const section = (label: string, category: ClassifiedUtterance["category"]) => {
    const items = utterances.filter((u) => u.category === category);
    if (items.length === 0) return;
    lines.push(`## ${label}`);
    items.forEach((u) => lines.push(`- ${displayText(u)}`));
    lines.push("");
  };

  section("症状", "symptom");
  section("診断・決定事項", "decision");
  section("処方・治療", "treatment");
  section("次回の予約", "appointment");
  section("気になること・質問", "worry");
  section("その他", "other");

  lines.push("## 会話の記録(全体)");
  utterances.forEach((u) => {
    lines.push(`- \`${formatTime(u.timestamp)}\` [${CATEGORY_LABEL[u.category]}] ${u.text}`);
  });

  return lines.join("\n");
}

/** 全発言を時系列のMarkdown記録に変換する(コピー・共有用) */
export function utterancesToSummaryMarkdown(utterances: ClassifiedUtterance[], mode: Mode = "meeting"): string {
  if (utterances.length === 0) {
    return mode === "karte" ? "# 通院カルテ\n\n(まだ会話が記録されていません)" : "# 議事録\n\n(まだ発言がありません)";
  }
  return mode === "karte" ? karteSummary(utterances) : meetingSummary(utterances);
}
