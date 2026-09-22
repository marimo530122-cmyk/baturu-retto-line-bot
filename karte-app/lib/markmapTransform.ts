import { CATEGORY_LABEL, ClassifiedUtterance, Mode } from "@/lib/types";

const MINDMAP_ORDER_BY_MODE: Record<Mode, Array<ClassifiedUtterance["category"]>> = {
  meeting: ["decision", "todo", "concern", "important", "question", "request"],
  karte: ["symptom", "decision", "treatment", "appointment", "worry"],
};

const TITLE_BY_MODE: Record<Mode, string> = {
  meeting: "会議マインドマップ",
  karte: "通院カルテ全体図",
};

/**
 * 分類済み発言の一覧を、markmap に渡すためのMarkdownアウトラインへ変換する。
 * 雑談(smalltalk)/その他(other)はマインドマップのノイズになるので除外する。
 */
export function utterancesToMarkdown(utterances: ClassifiedUtterance[], mode: Mode = "meeting"): string {
  const lines: string[] = [`# ${TITLE_BY_MODE[mode]}`];

  for (const category of MINDMAP_ORDER_BY_MODE[mode]) {
    const items = utterances.filter((u) => u.category === category);
    if (items.length === 0) continue;
    lines.push(`## ${CATEGORY_LABEL[category]}`);
    for (const item of items) {
      lines.push(`- ${item.summary || item.text}`);
    }
  }

  if (lines.length === 1) {
    lines.push("## (まだ分類済みの発言がありません)");
  }

  return lines.join("\n");
}
