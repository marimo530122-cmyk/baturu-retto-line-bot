"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import { formatReferralForCopy } from "@/lib/formatForCopy";
import { useFieldDebouncer } from "@/lib/useFieldDebouncer";
import type { ReferralLetter } from "@/lib/types";
import AutoGrowTextarea from "./AutoGrowTextarea";
import CopyButton from "./CopyButton";

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
  const [local, setLocal] = useState(referral);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const { schedule, flush } = useFieldDebouncer();

  useEffect(() => setLocal(referral), [referral]);

  async function persist(key: keyof ReferralLetter, value: string) {
    setStatus("saving");
    try {
      const updated = await api.updateReferral(sessionId, { [key]: value } as Partial<ReferralLetter>);
      onChange(updated);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (e) {
      reportError(e, { sessionId, field: key, action: "update-referral" });
      setStatus("idle");
    }
  }

  function handleChange(key: keyof ReferralLetter, value: string) {
    setLocal((prev) => ({ ...prev, [key]: value }));
    onChange({ ...local, [key]: value });
    schedule(key, () => persist(key, value));
  }

  function handleBlur(key: keyof ReferralLetter, value: string) {
    flush(key, () => persist(key, value));
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">診療情報提供書（紹介状）ドラフト</h3>
        <div className="flex items-center gap-2">
          {status === "saving" && <span className="text-xs text-gray-400">保存中...</span>}
          {status === "saved" && <span className="text-xs text-emerald-600">✓ 保存済み</span>}
          {referral.is_mock && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              MOCK（APIキー未設定）
            </span>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-sm font-medium text-gray-600">{label}</label>
            {key === "clinical_summary" ? (
              <AutoGrowTextarea
                value={local[key] as string}
                onChange={(e) => handleChange(key, e.target.value)}
                onBlur={(e) => handleBlur(key, e.target.value)}
                rows={3}
                className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2 focus:border-clinic-accent focus:ring-1 focus:ring-clinic-accent"
              />
            ) : (
              <input
                value={local[key] as string}
                onChange={(e) => handleChange(key, e.target.value)}
                onBlur={(e) => handleBlur(key, e.target.value)}
                className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2 focus:border-clinic-accent focus:ring-1 focus:ring-clinic-accent"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100">
        <CopyButton getText={() => formatReferralForCopy(local)} label="紹介状をコピー" />
      </div>
    </div>
  );
}
