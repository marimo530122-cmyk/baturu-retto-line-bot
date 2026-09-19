import { Category, ClassifyResult } from "@/lib/types";

export interface ClassifierBackend {
  classify(text: string, recentContext: string[]): Promise<ClassifyResult>;
}

export const CLASSIFY_SYSTEM_PROMPT = `あなたは会議の発言をリアルタイムで分類するアシスタントです。
入力された1発言を、次の7カテゴリのうち最も適切な1つに分類してください。

- decision: 決定事項(結論・合意が確定した発言)
- todo: 宿題(誰かがやるべきタスクが発生した発言)
- question: 質問(疑問・確認が投げかけられた発言)
- concern: 懸念(リスク・不安・問題点の指摘)
- request: 要望(依頼・要求・お願い)
- important: 重要事項(上記に当てはまらないが重要な情報)
- smalltalk: 雑談(上記に当てはまらない、議事に直接関係ない発言)

出力は必ず次のJSON形式のみ。説明文やコードブロックは付けないこと:
{"category":"<上記7つのうちいずれか>","summary":"<12文字程度の日本語要約>","importance":<1〜3の整数、3が最重要>}`;

export function buildUserPrompt(text: string, recentContext: string[]): string {
  const context = recentContext.length
    ? `直前の文脈(参考程度):\n${recentContext.map((c) => `- ${c}`).join("\n")}\n\n`
    : "";
  return `${context}分類対象の発言:\n"${text}"`;
}

export function parseClassifyJson(raw: string): ClassifyResult {
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;
  const parsed = JSON.parse(jsonText) as {
    category: string;
    summary: string;
    importance: number;
  };

  const validCategories: Category[] = [
    "decision",
    "todo",
    "question",
    "concern",
    "request",
    "important",
    "smalltalk",
  ];
  const category = validCategories.includes(parsed.category as Category)
    ? (parsed.category as Category)
    : "important";
  const importance = ([1, 2, 3].includes(parsed.importance) ? parsed.importance : 2) as 1 | 2 | 3;

  return {
    category,
    summary: parsed.summary?.slice(0, 60) || "",
    importance,
  };
}
