import { Category, CATEGORIES_BY_MODE, DEFAULT_CATEGORY_BY_MODE, ClassifyResult, Mode } from "@/lib/types";

export interface ClassifierBackend {
  classify(text: string, recentContext: string[], mode: Mode): Promise<ClassifyResult>;
}

export const SYSTEM_PROMPTS: Record<Mode, string> = {
  meeting: `あなたは会議の発言をリアルタイムで分類するアシスタントです。
入力された1発言を、次の7カテゴリのうち最も適切な1つに分類してください。

- decision: 決定事項(結論・合意が確定した発言)
- todo: 宿題(誰かがやるべきタスクが発生した発言)
- question: 質問(疑問・確認が投げかけられた発言)
- concern: 懸念(リスク・不安・問題点の指摘)
- request: 要望(依頼・要求・お願い)
- important: 重要事項(上記に当てはまらないが重要な情報)
- smalltalk: 雑談(上記に当てはまらない、議事に直接関係ない発言)

出力は必ず次のJSON形式のみ。説明文やコードブロックは付けないこと:
{"category":"<上記7つのうちいずれか>","summary":"<12文字程度の日本語要約>","importance":<1〜3の整数、3が最重要>}`,

  karte: `あなたは病院の診察に付き添っている家族の代わりに、医師と患者の会話をリアルタイムで
記録するアシスタントです。入力された1発言を、次の6カテゴリのうち最も適切な1つに分類してください。

- symptom: 症状(本人の体調・症状についての発言)
- decision: 診断・決定(治療方針・診断など、その場で決まったこと)
- treatment: 処方・治療(薬・処置・手術など治療に関する発言)
- appointment: 次回の予約(次回の診察日・検査日などの日程に関する発言)
- worry: 気になること・質問(疑問点や気がかりな点)
- other: その他(上記に当てはまらない発言)

出力は必ず次のJSON形式のみ。説明文やコードブロックは付けないこと:
{"category":"<上記6つのうちいずれか>","summary":"<12文字程度の日本語要約>","importance":<1〜3の整数、3が最重要>}`,
};

export function buildUserPrompt(text: string, recentContext: string[]): string {
  const context = recentContext.length
    ? `直前の文脈(参考程度):\n${recentContext.map((c) => `- ${c}`).join("\n")}\n\n`
    : "";
  return `${context}分類対象の発言:\n"${text}"`;
}

export function parseClassifyJson(raw: string, mode: Mode): ClassifyResult {
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;
  const parsed = JSON.parse(jsonText) as {
    category: string;
    summary: string;
    importance: number;
  };

  const validCategories: readonly Category[] = CATEGORIES_BY_MODE[mode];
  const category = validCategories.includes(parsed.category as Category)
    ? (parsed.category as Category)
    : DEFAULT_CATEGORY_BY_MODE[mode];
  const importance = ([1, 2, 3].includes(parsed.importance) ? parsed.importance : 2) as 1 | 2 | 3;

  return {
    category,
    summary: parsed.summary?.slice(0, 60) || "",
    importance,
  };
}
