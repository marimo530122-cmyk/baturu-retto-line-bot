import { Category, CATEGORIES_BY_MODE, DEFAULT_CATEGORY_BY_MODE, CATEGORY_LABEL, ClassifyResult, Mode } from "@/lib/types";
import { ClassifierBackend } from "./types";

/**
 * TypeSafe(Jev)による分類バックエンド。
 *
 * 公式ドキュメント(docs.opper.ai/build/gateway/evaluations, llmgateway.io の
 * System One ガイド)で確認済み: エンドポイントは POST /v1/systemone の1つのみ。
 * 1回のリクエストに questions をまとめて送り、answers.<質問id> の下に結果が返る。
 * choice の criteria は {id: 説明} のオブジェクト、score の criteria は順序つき
 * の説明文配列(2〜10段階)。score の値は 0 始まりの段階位置(3段階なら0〜2)。
 */

const INSTRUCTIONS_BY_MODE: Record<Mode, string> = {
  meeting: "この1発言を、会議の議事録分類として最も適切な1カテゴリに分類してください。",
  karte: "この1発言(病院での医師・患者の会話の一部)を、通院記録の分類として最も適切な1カテゴリに分類してください。",
};

const IMPORTANCE_LEVELS = [
  "軽微。読み返す必要は薄い雑談・相槌の類",
  "通常。記録に残す価値がある一般的な発言",
  "最重要。見落とすと支障が出る発言",
];

export class JevClassifier implements ClassifierBackend {
  constructor(
    private apiKey: string,
    private model: string = "jev-1.13.0",
    private baseUrl: string = "https://api.typesafe.ai"
  ) {}

  private async call(body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Jev systemone API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async classify(text: string, recentContext: string[], mode: Mode): Promise<ClassifyResult> {
    const state = { utterance: text, recent_context: recentContext };
    const categories = CATEGORIES_BY_MODE[mode];
    const criteria: Record<string, string> = {};
    for (const id of categories) criteria[id] = CATEGORY_LABEL[id];

    const res = await this.call({
      model: this.model,
      state,
      questions: {
        category: {
          type: "choice",
          instructions: INSTRUCTIONS_BY_MODE[mode],
          criteria,
        },
        importance: {
          type: "score",
          instructions: "この1発言は、後で見返す際にどれだけ重要か評価してください。",
          criteria: IMPORTANCE_LEVELS,
        },
      },
    });

    const answers = res?.answers ?? {};
    const rawChoice = answers?.category?.choice;
    const category: Category = (categories as readonly string[]).includes(rawChoice)
      ? (rawChoice as Category)
      : DEFAULT_CATEGORY_BY_MODE[mode];

    const rawScore = Number(answers?.importance?.score ?? 1);
    const levelIndex = Math.min(2, Math.max(0, Math.round(rawScore)));
    const importance = (levelIndex + 1) as 1 | 2 | 3;

    return {
      category,
      summary: text.slice(0, 20),
      importance,
    };
  }
}