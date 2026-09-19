"use client";

import { useState } from "react";
import { Mic, Square, RotateCcw, AlertTriangle, MessagesSquare, LayoutGrid } from "lucide-react";
import { Timeline } from "@/components/Timeline";
import { InsightPanel } from "@/components/InsightPanel";
import { useMeetingSession } from "@/hooks/useMeetingSession";

type MobileTab = "timeline" | "insight";

export default function Home() {
  const { utterances, interimText, isRecording, error, supported, start, stop, toggleTodo, reset } =
    useMeetingSession();
  const [mobileTab, setMobileTab] = useState<MobileTab>("timeline");

  return (
    <div className="flex h-dvh flex-col bg-gray-50">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">リアルタイム議事録</h1>
          <p className="text-xs text-gray-400">音声 → 7分類 → マインドマップ をリアルタイム生成</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            title="セッションをリセット"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {isRecording ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              <Square className="h-3.5 w-3.5" /> 停止
            </button>
          ) : (
            <button
              onClick={start}
              disabled={!supported}
              className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
            >
              <Mic className="h-3.5 w-3.5" /> 録音開始
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="flex shrink-0 items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* モバイル用タブ切り替え */}
      <div className="flex shrink-0 border-b border-gray-200 bg-white md:hidden">
        <button
          onClick={() => setMobileTab("timeline")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium ${
            mobileTab === "timeline" ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400"
          }`}
        >
          <MessagesSquare className="h-4 w-4" /> タイムライン
        </button>
        <button
          onClick={() => setMobileTab("insight")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium ${
            mobileTab === "insight" ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400"
          }`}
        >
          <LayoutGrid className="h-4 w-4" /> インサイト
        </button>
      </div>

      <main className="flex min-h-0 flex-1">
        <section
          className={`min-h-0 w-full flex-col border-r border-gray-200 bg-gray-50 md:flex md:w-2/5 ${
            mobileTab === "timeline" ? "flex" : "hidden"
          }`}
        >
          <Timeline utterances={utterances} interimText={interimText} />
        </section>
        <section
          className={`min-h-0 w-full flex-col md:flex md:flex-1 ${mobileTab === "insight" ? "flex" : "hidden"}`}
        >
          <InsightPanel utterances={utterances} onToggleTodo={toggleTodo} />
        </section>
      </main>
    </div>
  );
}
