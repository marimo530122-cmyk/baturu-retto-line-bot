"use client";

import type { LiveDraft } from "@/lib/types";

const fields: { key: keyof LiveDraft; label: string }[] = [
  { key: "chief_complaint", label: "主訴・症状の要約" },
  { key: "clinical_reasoning", label: "治療方針・提案" },
  { key: "prescription_draft", label: "処方内容・アドバイス" },
  { key: "referral_letter", label: "紹介状・診療情報提供書" },
];

export default function LiveDraftPreview({
  liveDraft,
  liveUpdating,
}: {
  liveDraft: LiveDraft;
  liveUpdating: boolean;
}) {
  const hasAnyContent = fields.some((f) => (liveDraft[f.key] as string)?.trim());

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold">アンビエントスクライブ ライブプレビュー</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            手動入力なし・会話から自動更新（この医師の文体プロファイルを反映）
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {liveUpdating && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse">
              自動生成中...
            </span>
          )}
          {liveDraft.is_mock && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              MOCK（APIキー未設定）
            </span>
          )}
        </div>
      </div>

      {!hasAnyContent && (
        <p className="text-sm text-gray-400">
          会話が始まると、ここに主訴・治療方針・処方・紹介状のドラフトが自動的に表示されます。
        </p>
      )}

      <div className="space-y-3">
        {fields.map(({ key, label }) => {
          const value = (liveDraft[key] as string) || "";
          if (!value.trim()) return null;
          return (
            <div key={key} className="border border-gray-100 rounded-md p-2 bg-gray-50">
              <div className="text-xs font-semibold text-clinic-primary mb-1">{label}</div>
              <p className="text-sm whitespace-pre-wrap">{value}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
