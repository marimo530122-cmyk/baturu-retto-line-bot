import { CATEGORY_LABEL, ClassifiedUtterance } from "@/lib/types";

const MINDMAP_ORDER: Array<ClassifiedUtterance["category"]> = [
  "decision",
  "todo",
  "concern",
  "important",
  "question",
  "request",
];

/**
 * 分類済み発言の一覧を、markmap に渡すためのMarkdownアウトラインへ変換する。
 * 雑談(smalltalk)はマインドマップのノイズになるので除外する。
 */
export function utterancesToMarkdown(utterances: ClassifiedUtterance[], title = "会議マインドマップ"): string {
  const lines: string[] = [`# ${title}`];

  for (const category of MINDMAP_ORDER) {
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
