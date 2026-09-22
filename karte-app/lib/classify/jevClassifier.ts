import { Category, CATEGORIES_BY_MODE, DEFAULT_CATEGORY_BY_MODE, CATEGORY_LABEL, ClassifyResult, Mode } from "@/lib/types";
import { ClassifierBackend } from "./types";

/**
 * TypeSafe(Jev)による分類バックエンド。
 *
 * 7カテゴリ(会議モード)/6カテゴリ(通院カルテモード)からの1択は Jev の Choice
 * プリミティブ、重要度(1〜3)は Score プリミティブに対応させている
 * (TypeSafeのSKILL.mdが薦める対応関係)。Jevは自由文を生成しないため、他バック
 * エンドと違い要約(summary)は発言の先頭を切り出したものを返す。
 *
 * 注意: docs.typesafe.ai への接続がビルド環境のネットワークポリシーで
 * ブロックされていたため、エンドポイントとリクエスト/レスポンス形式は
 * TypeSafeのClaude Codeスキルの説明(instructions + criteria + state ->
 * 選択/スコア)からの推測であり、公式ドキュメントで未確認。本番投入前に
 * https://docs.typesafe.ai/primitives/choice.md と
 * https://docs.typesafe.ai/primitives/score.md で正式な契約を確認し、
 * 必要なら call() のリクエスト/レスポンス処理を修正すること。
 */

const INSTRUCTIONS_BY_MODE: Record<Mode, string> = {
  meeting: "この1発言を、会議の議事録分類として最も適切な1カテゴリに分類してください。",
  karte: "この1発言(病院での医師・患者の会話の一部)を、通院記録の分類として最も適切な1カテゴリに分類してください。",
};

const IMPORTANCE_LEVELS = [
  { level: 1, description: "軽微。読み返す必要は薄い雑談・相槌の類" },
  { level: 2, description: "通常。記録に残す価値がある一般的な発言" },
  { level: 3, description: "最重要。見落とすと支障が出る発言" },
];

export class JevClassifier implements ClassifierBackend {
  constructor(
    private apiKey: string,
    private baseUrl: string = "https://api.typesafe.ai"
  ) {}

  private async call(primitive: "choice" | "score", body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}/v1/${primitive}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Jev ${primitive} API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async classify(text: string, recentContext: string[], mode: Mode): Promise<ClassifyResult> {
    const state = { utterance: text, recent_context: recentContext };
    const categories = CATEGORIES_BY_MODE[mode];
    const criteria = categories.map((id) => ({ id, description: CATEGORY_LABEL[id] }));

    const [choiceRes, scoreRes] = await Promise.all([
      this.call("choice", {
        instructions: INSTRUCTIONS_BY_MODE[mode],
        criteria,
        state,
      }),
      this.call("score", {
        instructions: "この1発言は、後で見返す際にどれだけ重要か評価してください。",
        criteria: IMPORTANCE_LEVELS,
        state,
      }),
    ]);

    // レスポンス形状は未確認のためベストエフォートで読む。
    const rawChoice = choiceRes?.choice ?? choiceRes?.result;
    const category: Category = (categories as readonly string[]).includes(rawChoice)
      ? (rawChoice as Category)
      : DEFAULT_CATEGORY_BY_MODE[mode];

    const rawScore = Number(scoreRes?.score ?? scoreRes?.level ?? 2);
    const importanceRounded = Math.round(rawScore);
    const importance = ([1, 2, 3].includes(importanceRounded) ? importanceRounded : 2) as 1 | 2 | 3;

    return {
      category,
      summary: text.slice(0, 20),
      importance,
    };
  }
}
