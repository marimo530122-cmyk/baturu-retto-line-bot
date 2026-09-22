"use client";

import { useEffect, useState } from "react";
import { X, Trash2, ChevronLeft } from "lucide-react";
import { HistoryEntry, deleteHistoryEntry, loadHistory } from "@/lib/history";
import { Mode } from "@/lib/types";
import { utterancesToSummaryMarkdown } from "@/lib/summaryTransform";
import { SummaryView } from "./SummaryView";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function HistoryView({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    setEntries(loadHistory().filter((e) => e.mode === mode));
  }, [mode]);

  const handleDelete = (id: string) => {
    deleteHistoryEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          {selected && (
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-900">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h2 className="text-sm font-semibold text-gray-900">
            {selected ? formatDate(selected.savedAt) : `過去の記録(${mode === "karte" ? "通院カルテ" : "議事録"})`}
          </h2>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {selected ? (
          <SummaryView
            markdown={utterancesToSummaryMarkdown(selected.utterances, selected.mode)}
            shareTitle={selected.mode === "karte" ? "通院カルテ" : "議事録"}
          />
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
            <p className="text-sm">まだ保存された記録はありません</p>
            <p className="text-xs">「リセット」を押すと、内容を保存するか選べます</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2 overflow-y-auto p-4">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
              >
                <button onClick={() => setSelected(e)} className="flex-1 text-left">
                  <p className="text-sm font-medium text-gray-900">{formatDate(e.savedAt)}</p>
                  <p className="text-xs text-gray-400">{e.utterances.length}件の記録</p>
                </button>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="ml-2 shrink-0 rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="削除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
