"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ReferralLetter } from "@/lib/types";

const fields: { key: keyof ReferralLetter; label: string }[] = [
  { key: "to_institution", label: "紹介先医療機関" },
  { key: "to_department", label: "診療科" },
  { key: "reason_for_referral", label: "紹介理由" },
  { key: "clinical_summary", label: "臨床経過の要約" },
  { key: "current_treatment", label: "現在の治療内容" },
  { key: "requested_action", label: "依頼事項" },
];

export default function ReferralLetterEditor({
  sessionId,
  referral,
  onChange,
}: {
  sessionId: string;
  referral: ReferralLetter;
  onChange: (referral: ReferralLetter) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function handleBlur(key: keyof ReferralLetter, value: string) {
    setSaving(key);
    try {
      const updated = await api.updateReferral(sessionId, {
        [key]: value,
      } as Partial<ReferralLetter>);
      onChange(updated);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">診療情報提供書（紹介状）ドラフト</h3>
        {referral.is_mock && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
            MOCK（APIキー未設定）
          </span>
        )}
      </div>
      <div className="space-y-3">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-sm font-medium text-gray-600">{label}</label>
            {key === "clinical_summary" ? (
              <textarea
                defaultValue={referral[key] as string}
                onBlur={(e) => handleBlur(key, e.target.value)}
                rows={3}
                className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2"
              />
            ) : (
              <input
                defaultValue={referral[key] as string}
                onBlur={(e) => handleBlur(key, e.target.value)}
                className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2"
              />
            )}
          </div>
        ))}
        {saving && <p className="text-xs text-gray-400">保存中...</p>}
      </div>
    </div>
  );
}
