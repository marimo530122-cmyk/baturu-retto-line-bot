"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import type { DrugSuggestionResult } from "@/lib/types";

// 薬剤候補の提案(AI)。あくまで医師の検討材料として「表示するだけ」のパネル。
// 安全のため、提案を処方欄へ反映するボタンは意図的に置いていない
// (採用する場合は医師が添付文書等で確認のうえ、処方欄に薬剤名・用量を自分で入力する)。
export default function DrugSuggestionPanel({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DrugSuggestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.suggestDrugs(sessionId));
    } catch (e) {
      reportError(e, { sessionId, action: "drug-suggestions" });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">薬剤候補の提案（AI・参考情報）</h4>
          <p className="text-xs text-gray-500">
            SOAPカルテのS（訴え）とA（評価）だけを根拠に候補を表示します。処方欄には反映されません。
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="shrink-0 border border-clinic-accent text-clinic-accent text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
        >
          {loading ? "検討中..." : result ? "再提案" : "候補を表示"}
        </button>
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-2">
          <p className="text-xs text-clinic-danger flex-1">{error}</p>
          <button onClick={run} className="text-xs font-medium text-clinic-accent underline">
            再試行
          </button>
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-900">
            {result.disclaimer}
          </div>

          {result.is_mock && (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              MOCK（APIキー未設定）
            </span>
          )}

          {result.notice && <p className="text-xs text-gray-600">{result.notice}</p>}

          {result.suggestions.map((s, i) => (
            <div key={i} className="border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{s.drug_name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  参考・要医師判断
                </span>
              </div>
              <p className="text-sm text-gray-800 mt-1">{s.suggestion_text}</p>
              <p className="text-xs text-gray-600 mt-2">
                <span className="font-medium">根拠（カルテより引用）: </span>「{s.grounding_quote}」
              </p>
              {s.rationale && <p className="text-xs text-gray-600 mt-1">理由: {s.rationale}</p>}
              {s.cautions && (
                <p className="text-xs text-clinic-danger mt-1">確認事項: {s.cautions}</p>
              )}
            </div>
          ))}

          {result.discarded_count > 0 && (
            <p className="text-xs text-gray-400">
              カルテの記載で根拠を確認できなかった提案など {result.discarded_count} 件は表示していません。
            </p>
          )}

          {result.suggestions.length > 0 && (
            <p className="text-xs text-gray-500">
              採用する場合は、上の処方欄に薬剤名・用量・日数を医師ご自身で入力してください。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
