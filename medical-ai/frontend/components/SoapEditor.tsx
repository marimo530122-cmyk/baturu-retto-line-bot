"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { SoapNote } from "@/lib/types";

const fields: { key: keyof SoapNote; label: string }[] = [
  { key: "subjective", label: "S（主観的情報）" },
  { key: "objective", label: "O（客観的情報）" },
  { key: "assessment", label: "A（評価）" },
  { key: "plan", label: "P（計画）" },
];

export default function SoapEditor({
  sessionId,
  soap,
  onChange,
}: {
  sessionId: string;
  soap: SoapNote;
  onChange: (soap: SoapNote) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function handleBlur(key: keyof SoapNote, value: string) {
    setSaving(key);
    try {
      const updated = await api.updateSoap(sessionId, { [key]: value } as Partial<SoapNote>);
      onChange(updated);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">SOAPカルテ</h3>
        {soap.is_mock && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
            MOCK（APIキー未設定）
          </span>
        )}
      </div>
      <div className="space-y-3">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-sm font-medium text-gray-600">{label}</label>
            <textarea
              defaultValue={soap[key] as string}
              onBlur={(e) => handleBlur(key, e.target.value)}
              rows={2}
              className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2"
            />
          </div>
        ))}
        {saving && <p className="text-xs text-gray-400">保存中...</p>}
      </div>
    </div>
  );
}
