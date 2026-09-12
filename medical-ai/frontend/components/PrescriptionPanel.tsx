"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ComplianceCheckResult, PrescriptionItem, PrescriptionOrder } from "@/lib/types";
import ComplianceSuggestionModal from "./ComplianceSuggestionModal";

const emptyItem: PrescriptionItem = {
  drug_name: "",
  dosage: "",
  frequency: "",
  days_supply: 14,
  quantity: "",
  notes: "",
};

export default function PrescriptionPanel({
  sessionId,
  prescription,
  liveUpdating,
  onChange,
}: {
  sessionId: string;
  prescription: PrescriptionOrder;
  liveUpdating: boolean;
  onChange: (order: PrescriptionOrder) => void;
}) {
  const [requestedDays, setRequestedDays] = useState<number | "">("");
  const [checking, setChecking] = useState(false);
  const [complianceResult, setComplianceResult] = useState<ComplianceCheckResult | null>(null);

  async function persist(next: PrescriptionOrder) {
    onChange(next);
    const updated = await api.updatePrescription(sessionId, {
      diagnosis: next.diagnosis,
      items: next.items,
      patient_request_note: next.patient_request_note,
    });
    onChange(updated);
  }

  function updateItem(index: number, patch: Partial<PrescriptionItem>) {
    const items = prescription.items.map((it, i) => (i === index ? { ...it, ...patch } : it));
    persist({ ...prescription, items });
  }

  function addItem() {
    persist({ ...prescription, items: [...prescription.items, { ...emptyItem }] });
  }

  function removeItem(index: number) {
    persist({ ...prescription, items: prescription.items.filter((_, i) => i !== index) });
  }

  async function runComplianceCheck() {
    setChecking(true);
    try {
      const result = await api.checkCompliance(
        sessionId,
        requestedDays === "" ? undefined : Number(requestedDays)
      );
      setComplianceResult(result);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">処方オーダ</h3>
        <div className="flex items-center gap-2">
          {liveUpdating && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse">
              会話から自動構築中...
            </span>
          )}
          {prescription.is_mock && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              MOCK（APIキー未設定）
            </span>
          )}
        </div>
      </div>

      <div className="mb-3">
        <label className="text-sm font-medium text-gray-600">診断名（医師の発言に基づく）</label>
        <input
          value={prescription.diagnosis}
          onChange={(e) => onChange({ ...prescription, diagnosis: e.target.value })}
          onBlur={(e) => persist({ ...prescription, diagnosis: e.target.value })}
          className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2"
        />
      </div>

      {prescription.patient_request_note && (
        <div className="mb-3 text-sm bg-gray-50 border border-gray-200 rounded-md p-2">
          <span className="font-medium text-gray-600">患者の要望: </span>
          {prescription.patient_request_note}
        </div>
      )}

      <div className="space-y-2 mb-3">
        {prescription.items.map((item, i) => (
          <div key={i} className="grid grid-cols-12 gap-1 items-center border border-gray-100 rounded-md p-2 bg-gray-50">
            <input
              className="col-span-3 border border-gray-300 rounded px-1 py-1 text-xs"
              placeholder="薬剤名"
              value={item.drug_name}
              onChange={(e) => updateItem(i, { drug_name: e.target.value })}
            />
            <input
              className="col-span-2 border border-gray-300 rounded px-1 py-1 text-xs"
              placeholder="用量"
              value={item.dosage}
              onChange={(e) => updateItem(i, { dosage: e.target.value })}
            />
            <input
              className="col-span-2 border border-gray-300 rounded px-1 py-1 text-xs"
              placeholder="頻度"
              value={item.frequency}
              onChange={(e) => updateItem(i, { frequency: e.target.value })}
            />
            <input
              type="number"
              className="col-span-1 border border-gray-300 rounded px-1 py-1 text-xs"
              placeholder="日数"
              value={item.days_supply}
              onChange={(e) => updateItem(i, { days_supply: Number(e.target.value) })}
            />
            <input
              className="col-span-2 border border-gray-300 rounded px-1 py-1 text-xs"
              placeholder="数量"
              value={item.quantity}
              onChange={(e) => updateItem(i, { quantity: e.target.value })}
            />
            <button
              onClick={() => removeItem(i)}
              className="col-span-2 text-xs text-clinic-danger"
            >
              削除
            </button>
          </div>
        ))}
        <button onClick={addItem} className="text-xs text-clinic-accent font-medium">
          + 薬剤を追加
        </button>
      </div>

      <div className="flex items-end gap-2 border-t border-gray-100 pt-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block">希望投薬日数</label>
          <input
            type="number"
            value={requestedDays}
            onChange={(e) => setRequestedDays(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-24 border border-gray-300 rounded-md text-sm p-1.5"
            placeholder="例: 30"
          />
        </div>
        <button
          onClick={runComplianceCheck}
          disabled={checking}
          className="bg-clinic-warn text-white text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
        >
          {checking ? "確認中..." : "処方適正化チェック"}
        </button>
      </div>

      {complianceResult && complianceResult.triggered && (
        <ComplianceSuggestionModal
          result={complianceResult}
          onClose={() => setComplianceResult(null)}
        />
      )}
      {complianceResult && !complianceResult.triggered && (
        <p className="text-xs text-emerald-700 mt-2">
          院内ルールの投薬日数上限の範囲内です。特に代替案の提示はありません。
        </p>
      )}
    </div>
  );
}
