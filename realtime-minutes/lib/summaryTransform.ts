import { CATEGORY_LABEL, ClassifiedUtterance } from "@/lib/types";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** 全発言を時系列のMarkdown議事録に変換する(コピー・共有用) */
export function utterancesToSummaryMarkdown(utterances: ClassifiedUtterance[]): string {
  if (utterances.length === 0) {
    return "# 議事録\n\n(まだ発言がありません)";
  }

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

  lines.push("## タイムライン(全発言)");
  utterances.forEach((u) => {
    lines.push(`- \`${formatTime(u.timestamp)}\` [${CATEGORY_LABEL[u.category]}] ${u.text}`);
  });

  return lines.join("\n");
}
