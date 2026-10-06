"use client";

import { useEffect, useState } from "react";
import { X, Trash2, ChevronLeft, Camera, AlertCircle } from "lucide-react";
import { HistoryEntry, deleteHistoryEntry, loadHistory } from "@/lib/history";
import { PhotoHistoryEntry, deletePhotoHistoryEntry, loadPhotoHistory } from "@/lib/photoHistory";
import { getPhotoBlob } from "@/lib/photoStore";
import { Mode } from "@/lib/types";
import { utterancesToSummaryMarkdown } from "@/lib/summaryTransform";
import { SummaryView } from "./SummaryView";

type HistoryTab = "sessions" | "photos";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 撮った写真そのもの(縮小サムネイル)をIndexedDBから読み込んで表示する */
function PhotoThumbnail({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getPhotoBlob(id).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (!url) {
    return <div className="h-14 w-14 shrink-0 rounded-md bg-gray-100" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-md border border-gray-200 object-cover" />
  );
}

function PhotoHistoryList() {
  const [entries, setEntries] = useState<PhotoHistoryEntry[]>([]);

  useEffect(() => {
    setEntries(loadPhotoHistory());
  }, []);

  const handleDelete = (id: string) => {
    deletePhotoHistoryEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
        <Camera className="h-8 w-8" />
        <p className="text-sm">まだ写真を撮って読み取った記録はありません</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {entries.map((e) => (
        <li
          key={e.id}
          className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PhotoThumbnail id={e.id} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {e.status !== "success" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                <p className="text-sm font-medium text-gray-900">{formatDate(e.capturedAt)}</p>
              </div>
              <p className="truncate text-xs text-gray-400">
                {e.status === "success"
                  ? e.preview || "(読み取り成功)"
                  : e.status === "empty"
                    ? "文字を読み取れませんでした"
                    : `読み取り失敗: ${e.preview}`}
              </p>
            </div>
          </div>
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
  );
}

export function HistoryView({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const [tab, setTab] = useState<HistoryTab>("sessions");
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
            {selected
              ? formatDate(selected.savedAt)
              : tab === "sessions"
                ? `過去の記録(${mode === "karte" ? "通院カルテ" : "議事録"})`
                : "写真の読み取り履歴"}
          </h2>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
          <X className="h-5 w-5" />
        </button>
      </div>

      {!selected && (
        <div className="flex shrink-0 gap-1 border-b border-gray-200 bg-white px-2 py-1.5">
          <button
            onClick={() => setTab("sessions")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "sessions" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            記録
          </button>
          <button
            onClick={() => setTab("photos")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "photos" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            写真履歴
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {selected ? (
          <SummaryView
            markdown={utterancesToSummaryMarkdown(selected.utterances, selected.mode)}
            shareTitle={selected.mode === "karte" ? "通院カルテ" : "議事録"}
          />
        ) : tab === "photos" ? (
          <PhotoHistoryList />
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
