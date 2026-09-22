import { Category, ClassifyResult, Mode } from "@/lib/types";
import { ClassifierBackend } from "./types";

/**
 * APIキー不要のルールベース分類器。
 * セットアップ直後の動作確認や、AIバックエンド未接続時のフォールバックとして使う。
 */
const MEETING_RULES: Array<{ category: Category; keywords: string[] }> = [
  { category: "decision", keywords: ["決定", "確定", "そうしましょう", "それでいきます", "合意"] },
  {
    category: "todo",
    keywords: ["やっておきます", "対応します", "宿題", "タスク", "までにやります", "ておきます", "しておく"],
  },
  { category: "question", keywords: ["ですか", "でしょうか", "どうする", "教えて"] },
  { category: "concern", keywords: ["心配", "懸念", "リスク", "大丈夫かな", "不安"] },
  { category: "request", keywords: ["お願いします", "してほしい", "欲しいです", "依頼"] },
  { category: "important", keywords: ["重要", "大事", "ポイントは", "注意"] },
];

const KARTE_RULES: Array<{ category: Category; keywords: string[] }> = [
  { category: "symptom", keywords: ["痛い", "熱", "だるい", "気持ち悪い", "しびれ", "調子が"] },
  { category: "decision", keywords: ["診断", "ということです", "所見", "様子を見ましょう"] },
  { category: "treatment", keywords: ["薬", "処方", "注射", "点滴", "手術", "服用"] },
  { category: "appointment", keywords: ["次回", "予約", "また来て", "来週", "1ヶ月後"] },
  { category: "worry", keywords: ["心配", "大丈夫かな", "気になる", "不安", "どうなん"] },
];

export class MockClassifier implements ClassifierBackend {
  async classify(text: string, _recentContext: string[], mode: Mode = "meeting"): Promise<ClassifyResult> {
    const rules = mode === "karte" ? KARTE_RULES : MEETING_RULES;
    for (const rule of rules) {
      if (rule.keywords.some((kw) => text.includes(kw))) {
        return {
          category: rule.category,
          summary: text.slice(0, 20),
          importance: rule.category === "decision" || rule.category === "concern" ? 3 : 2,
        };
      }
    }
    return {
      category: mode === "karte" ? "other" : "smalltalk",
      summary: text.slice(0, 20),
      importance: 1,
    };
  }
}
