"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import { formatPrescriptionForCopy } from "@/lib/formatForCopy";
import { useFieldDebouncer } from "@/lib/useFieldDebouncer";
import type { ComplianceCheckResult, PrescriptionItem, PrescriptionOrder } from "@/lib/types";
import ComplianceSuggestionModal from "./ComplianceSuggestionModal";
import CopyButton from "./CopyButton";
import DrugSuggestionPanel from "./DrugSuggestionPanel";

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
  // 以前はフィールドを1文字打つたびにAPIへ保存していたため編集がもっさりしていた。
  // ローカル表示は即座に更新しつつ、実際の保存は入力が止まってから(or 確定操作時に)行う。
  const [local, setLocal] = useState(prescription);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const latestRef = useRef(prescription);
  const { schedule, flush } = useFieldDebouncer();

  useEffect(() => {
    setLocal(prescription);
    latestRef.current = prescription;
  }, [prescription]);

  // 薬剤候補の提案は設定で「切」にできる(既定は切)。確認できない間も出さない側に倒す。
  const [drugSuggestionsEnabled, setDrugSuggestionsEnabled] = useState(false);
  useEffect(() => {
    api
      .getFeatures()
      .then((f) => setDrugSuggestionsEnabled(f.drug_suggestions))
      .catch(() => setDrugSuggestionsEnabled(false));
  }, []);

  const [requestedDays, setRequestedDays] = useState<number | "">("");
  const [checking, setChecking] = useState(false);
  const [complianceResult, setComplianceResult] = useState<ComplianceCheckResult | null>(null);
  const [complianceError, setComplianceError] = useState<string | null>(null);

  async function persist(next: PrescriptionOrder) {
    setStatus("saving");
    try {
      const updated = await api.updatePrescription(sessionId, {
        diagnosis: next.diagnosis,
        items: next.items,
        patient_request_note: next.patient_request_note,
      });
      onChange(updated);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (e) {
      reportError(e, { sessionId, action: "update-prescription" });
      setStatus("idle");
    }
  }

  function reflect(next: PrescriptionOrder) {
    setLocal(next);
    latestRef.current = next;
    onChange(next);
  }

  function updateItem(index: number, patch: Partial<PrescriptionItem>) {
    const items = local.items.map((it, i) => (i === index ? { ...it, ...patch } : it));
    const next = { ...local, items };
    reflect(next);
    schedule("items", () => persist(latestRef.current));
  }

  function flushItems() {
    flush("items", () => persist(latestRef.current));
  }

  function addItem() {
    const next = { ...local, items: [...local.items, { ...emptyItem }] };
    reflect(next);
    flush("items", () => persist(next));
  }

  function removeItem(index: number) {
    const next = { ...local, items: local.items.filter((_, i) => i !== index) };
    reflect(next);
    flush("items", () => persist(next));
  }

  function handleDiagnosisChange(value: string) {
    const next = { ...local, diagnosis: value };
    reflect(next);
    schedule("diagnosis", () => persist(latestRef.current));
  }

  async function runComplianceCheck() {
    setChecking(true);
    setComplianceError(null);
    try {
      const result = await api.checkCompliance(
        sessionId,
        requestedDays === "" ? undefined : Number(requestedDays)
      );
      setComplianceResult(result);
    } catch (e) {
      reportError(e, { sessionId, action: "compliance-check" });
      setComplianceError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">処方オーダ</h3>
        <div className="flex items-center gap-2">
          {status === "saving" && <span className="text-xs text-gray-400">保存中...</span>}
          {status === "saved" && <span className="text-xs text-emerald-600">✓ 保存済み</span>}
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
          value={local.diagnosis}
          onChange={(e) => handleDiagnosisChange(e.target.value)}
          onBlur={() => flush("diagnosis", () => persist(latestRef.current))}
          className="w-full mt-1 border border-gray-300 rounded-md text-sm p-2 focus:border-clinic-accent focus:ring-1 focus:ring-clinic-accent"
        />
      </div>

      {local.patient_request_note && (
        <div className="mb-3 text-sm bg-gray-50 border border-gray-200 rounded-md p-2">
          <span className="font-medium text-gray-600">患者の要望: </span>
          {local.patient_request_note}
        </div>
      )}

      <div className="space-y-2 mb-3">
        {local.items.map((item, i) => (
          <div key={i} className="grid grid-cols-12 gap-1 items-center border border-gray-100 rounded-md p-2 bg-gray-50">
            <input
              className="col-span-3 border border-gray-300 rounded px-1 py-1 text-xs focus:border-clinic-accent"
              placeholder="薬剤名"
              value={item.drug_name}
              onChange={(e) => updateItem(i, { drug_name: e.target.value })}
              onBlur={flushItems}
            />
            <input
              className="col-span-2 border border-gray-300 rounded px-1 py-1 text-xs focus:border-clinic-accent"
              placeholder="用量"
              value={item.dosage}
              onChange={(e) => updateItem(i, { dosage: e.target.value })}
              onBlur={flushItems}
            />
            <input
              className="col-span-2 border border-gray-300 rounded px-1 py-1 text-xs focus:border-clinic-accent"
              placeholder="頻度"
              value={item.frequency}
              onChange={(e) => updateItem(i, { frequency: e.target.value })}
              onBlur={flushItems}
            />
            <input
              type="number"
              className="col-span-1 border border-gray-300 rounded px-1 py-1 text-xs focus:border-clinic-accent"
              placeholder="日数"
              value={item.days_supply}
              onChange={(e) => updateItem(i, { days_supply: Number(e.target.value) })}
              onBlur={flushItems}
            />
            <input
              className="col-span-2 border border-gray-300 rounded px-1 py-1 text-xs focus:border-clinic-accent"
              placeholder="数量"
              value={item.quantity}
              onChange={(e) => updateItem(i, { quantity: e.target.value })}
              onBlur={flushItems}
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

      {complianceError && (
        <div className="mt-2 flex items-center gap-2">
          <p className="text-xs text-clinic-danger flex-1">{complianceError}</p>
          <button onClick={runComplianceCheck} className="text-xs font-medium text-clinic-accent underline">
            再試行
          </button>
        </div>
      )}

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

      {/* key: 別の患者のセッションに切り替えたら前の患者の提案を残さない */}
      {drugSuggestionsEnabled && <DrugSuggestionPanel key={sessionId} sessionId={sessionId} />}

      <div className="mt-4 pt-3 border-t border-gray-100">
        <CopyButton getText={() => formatPrescriptionForCopy(local)} label="処方内容をコピー" />
      </div>
    </div>
  );
}
