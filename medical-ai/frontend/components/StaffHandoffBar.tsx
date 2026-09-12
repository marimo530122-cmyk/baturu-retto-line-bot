"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { HandoffTarget } from "@/lib/types";

export default function StaffHandoffBar({
  sessionId,
  disabled,
  onSent,
}: {
  sessionId: string;
  disabled: boolean;
  onSent: () => void;
}) {
  const [targets, setTargets] = useState<HandoffTarget[]>(["nurse", "pharmacy"]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function toggleTarget(t: HandoffTarget) {
    setTargets((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function handleSend() {
    setSending(true);
    try {
      await api.sendHandoff(sessionId, targets, note);
      setSent(true);
      onSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <h3 className="font-semibold mb-2">スタッフ連携</h3>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={targets.includes("nurse")}
            onChange={() => toggleTarget("nurse")}
          />
          看護師へ送信
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={targets.includes("pharmacy")}
            onChange={() => toggleTarget("pharmacy")}
          />
          調剤へ送信
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="申し送り事項（任意）"
          className="flex-1 min-w-[10rem] border border-gray-300 rounded-md text-sm p-2"
        />
      </div>
      <button
        onClick={handleSend}
        disabled={disabled || sending || targets.length === 0 || sent}
        className="w-full bg-clinic-primary text-white font-semibold py-2.5 rounded-md disabled:opacity-50"
      >
        {sent ? "送信済み" : sending ? "送信中..." : "ワンタップでスタッフに連携"}
      </button>
      {disabled && !sent && (
        <p className="text-xs text-gray-400 mt-1">
          医師の確認・生成完了後に送信できます（診察を終了してカルテを生成してください）。
        </p>
      )}
    </div>
  );
}
