import { Category, ClassifyResult } from "@/lib/types";
import { ClassifierBackend } from "./types";

/**
 * APIキー不要のルールベース分類器。
 * セットアップ直後の動作確認や、AIバックエンド未接続時のフォールバックとして使う。
 */
const KEYWORD_RULES: Array<{ category: Category; keywords: string[] }> = [
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

export class MockClassifier implements ClassifierBackend {
  async classify(text: string): Promise<ClassifyResult> {
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => text.includes(kw))) {
        return {
          category: rule.category,
          summary: text.slice(0, 20),
          importance: rule.category === "decision" || rule.category === "concern" ? 3 : 2,
        };
      }
    }
    return {
      category: "smalltalk",
      summary: text.slice(0, 20),
      importance: 1,
    };
  }
}
