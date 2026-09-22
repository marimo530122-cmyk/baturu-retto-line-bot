export interface MarkdownSection {
  heading: string;
  items: string[];
}

export interface ParsedMarkdown {
  title: string;
  meta: string[];
  sections: MarkdownSection[];
}

/**
 * summaryTransform.ts が出力する単純なMarkdown(# タイトル / メタ行 / ## 見出し / - 箇条書き)を
 * カード表示用に分解する。汎用Markdownパーサーではなく、このアプリの出力形式専用。
 */
export function parseMarkdownSections(markdown: string): ParsedMarkdown {
  const lines = markdown.split("\n");
  let title = "";
  const meta: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      current = { heading: line.slice(3).trim(), items: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith("- ")) {
      const item = line.replace(/^- (\[[ x]\]\s*)?/, "").trim();
      if (current) current.items.push(item);
      continue;
    }
    if (current) {
      current.items.push(line);
    } else {
      meta.push(line);
    }
  }

  return { title, meta, sections };
}
