"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import { formatSoapForCopy } from "@/lib/formatForCopy";
import { useFieldDebouncer } from "@/lib/useFieldDebouncer";
import type { SoapNote } from "@/lib/types";
import AutoGrowTextarea from "./AutoGrowTextarea";
import CopyButton from "./CopyButton";

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
  // ローカルの表示用state。入力のたびに即座にここへ反映し、サクサク打てるようにする
  const [local, setLocal] = useState(soap);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const { schedule, flush } = useFieldDebouncer();

  // 親から新しいsoap(finalize直後・他端末での更新等)が来たら表示を同期する
  useEffect(() => setLocal(soap), [soap]);

  async function persist(key: keyof SoapNote, value: string) {
    setStatus("saving");
    try {
      const updated = await api.updateSoap(sessionId, { [key]: value } as Partial<SoapNote>);
      onChange(updated);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (e) {
      reportError(e, { sessionId, field: key, action: "update-soap" });
      setStatus("idle");
    }
  }

  function handleChange(key: keyof SoapNote, value: string) {
    setLocal((prev) => ({ ...prev, [key]: value }));
    // 確定データ(親のsession.soap)にも即座に反映しておく(保存は裏で追いつく)
    onChange({ ...local, [key]: value });
    schedule(key, () => persist(key, value));
  }

  function handleBlur(key: keyof SoapNote, value: string) {
    flush(key, () => persist(key, value));
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">SOAPカルテ</h3>
        <div className="flex items-center gap-2">
          {status === "saving" && <span className="text-xs text-gray-400">保存中...</span>}
          {status === "saved" && <span className="text-xs text-emerald-600">✓ 保存済み</span>}
          {soap.is_mock && (
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
            <AutoGrowTextarea
              value={local[key] as string}
              onChange={(e) => handleChange(key, e.target.value)}
              onBlur={(e) => handleBlur(key, e.target.value)}
              rows={2}
              className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2 focus:border-clinic-accent focus:ring-1 focus:ring-clinic-accent"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100">
        <CopyButton getText={() => formatSoapForCopy(local)} label="SOAPカルテをコピー" />
      </div>
    </div>
  );
}
