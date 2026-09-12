"use client";

import type { ComplianceCheckResult } from "@/lib/types";

const kindLabel: Record<string, string> = {
  existing_diagnosis_exception: "既存診断の特例該当チェック",
  outside_prescription: "院外処方せんへの切替",
  split_visit: "分割処方（複数回来院）",
  self_pay: "自費（自由診療）処方",
};

export default function ComplianceSuggestionModal({
  result,
  onClose,
}: {
  result: ComplianceCheckResult;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-lg w-full max-h-[85vh] overflow-y-auto p-5">
        <h3 className="font-bold text-lg mb-1">処方適正化アドバイザー</h3>
        <p className="text-xs text-gray-500 mb-3">
          希望数量が院内ルールの投薬日数上限を超えています。以下は合法的な代替案です。
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-900 mb-4">
          {result.disclaimer}
        </div>

        <div className="space-y-3">
          {result.suggestions.map((s, i) => (
            <div key={i} className="border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-clinic-primary">
                  {kindLabel[s.kind] || s.kind}
                </span>
                {s.requires_physician_confirmation && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                    要医師確認
                  </span>
                )}
              </div>
              <div className="font-medium text-sm mt-1">{s.title}</div>
              <p className="text-sm text-gray-700 mt-1">{s.description}</p>
              <p className="text-xs text-gray-400 mt-1">根拠: {s.legal_basis}</p>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full bg-clinic-primary text-white rounded-md py-2 text-sm font-medium"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
