import { Category, ClassifyResult } from "@/lib/types";
import { ClassifierBackend } from "./types";

/**
 * TypeSafe(Jev)による分類バックエンド。
 *
 * 7カテゴリからの1択は Jev の Choice プリミティブ、重要度(1〜3)は Score
 * プリミティブに対応させている(TypeSafeのSKILL.mdが薦める対応関係)。
 * Jevは自由文を生成しないため、他バックエンドと違い要約(summary)は発言の
 * 先頭を切り出したものを返す(Gemini/Claudeのような生成要約ではない)。
 *
 * 注意: docs.typesafe.ai への接続がビルド環境のネットワークポリシーで
 * ブロックされていたため、エンドポイントとリクエスト/レスポンス形式は
 * TypeSafeのClaude Codeスキルの説明(instructions + criteria + state ->
 * 選択/スコア)からの推測であり、公式ドキュメントで未確認。本番投入前に
 * https://docs.typesafe.ai/primitives/choice.md と
 * https://docs.typesafe.ai/primitives/score.md で正式な契約を確認し、
 * 必要なら call() のリクエスト/レスポンス処理を修正すること。
 */

const CATEGORY_CRITERIA: Array<{ id: Category; description: string }> = [
  { id: "decision", description: "決定事項: 結論・合意が確定した発言" },
  { id: "todo", description: "宿題: 誰かがやるべきタスクが発生した発言" },
  { id: "question", description: "質問: 疑問・確認が投げかけられた発言" },
  { id: "concern", description: "懸念: リスク・不安・問題点の指摘" },
  { id: "request", description: "要望: 依頼・要求・お願い" },
  { id: "important", description: "重要事項: 上記に当てはまらないが重要な情報" },
  { id: "smalltalk", description: "雑談: 上記に当てはまらない、議事に直接関係ない発言" },
];

const IMPORTANCE_LEVELS = [
  { level: 1, description: "軽微。読み返す必要は薄い雑談・相槌の類" },
  { level: 2, description: "通常。議事録に残す価値がある一般的な発言" },
  { level: 3, description: "最重要。見落とすと業務に支障が出る発言" },
];

const VALID_CATEGORIES = new Set(CATEGORY_CRITERIA.map((c) => c.id));

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

  async classify(text: string, recentContext: string[]): Promise<ClassifyResult> {
    const state = { utterance: text, recent_context: recentContext };

    const [choiceRes, scoreRes] = await Promise.all([
      this.call("choice", {
        instructions: "この1発言を、会議の議事録分類として最も適切な1カテゴリに分類してください。",
        criteria: CATEGORY_CRITERIA,
        state,
      }),
      this.call("score", {
        instructions: "この1発言は、議事録として見返す際にどれだけ重要か評価してください。",
        criteria: IMPORTANCE_LEVELS,
        state,
      }),
    ]);

    // レスポンス形状は未確認のためベストエフォートで読む。
    const rawChoice = choiceRes?.choice ?? choiceRes?.result;
    const category: Category = VALID_CATEGORIES.has(rawChoice) ? rawChoice : "important";

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
