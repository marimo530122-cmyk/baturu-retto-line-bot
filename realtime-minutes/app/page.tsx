"use client";

import { useCallback, useState } from "react";
import { Mic, Square, RotateCcw, AlertTriangle, MessagesSquare, LayoutGrid, History, Keyboard, Send } from "lucide-react";
import { Timeline } from "@/components/Timeline";
import { InsightPanel } from "@/components/InsightPanel";
import { HistoryView } from "@/components/HistoryView";
import { DocumentScanInput } from "@/components/DocumentScanInput";
import { QrCodeButton } from "@/components/QrCodeButton";
import { InAppBrowserBanner, InAppBrowserOverlay, useInAppBrowser } from "@/components/InAppBrowserNotice";
import { BraveNotice, useBraveDetection } from "@/components/BraveNotice";
import { useMeetingSession } from "@/hooks/useMeetingSession";
import { saveHistoryEntry } from "@/lib/history";
import { MODE_META, Mode } from "@/lib/types";

type MobileTab = "timeline" | "insight";

export default function Home() {
  const [mode, setMode] = useState<Mode>("meeting");
  const { utterances, interimText, isRecording, error, status, supported, start, stop, toggleTodo, reset, submitText } =
    useMeetingSession(mode);
  const [mobileTab, setMobileTab] = useState<MobileTab>("timeline");
  const [showHistory, setShowHistory] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textValue, setTextValue] = useState("");
  // アプリ内ブラウザ(TikTok等)ではマイクが許可されないため、録音を禁止して標準ブラウザへ誘導する
  const inAppBrowser = useInAppBrowser();
  const [showInAppGuide, setShowInAppGuide] = useState(true);
  const recordingBlocked = !supported || inAppBrowser !== null;

  // Brave はデフォルトで音声認識サーバーをブロックするため、事前に警告する
  const isBrave = useBraveDetection();
  const [showBraveNotice, setShowBraveNotice] = useState(true);

  const saveThenClear = useCallback(() => {
    if (utterances.length > 0) {
      const shouldSave = window.confirm(
        "今の内容を「過去の記録」に保存してから消しますか？\n(OK: 保存して消す / キャンセル: 保存せず消す)"
      );
      if (shouldSave) saveHistoryEntry(mode, utterances);
    }
    reset();
  }, [utterances, mode, reset]);

  const changeMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      if (isRecording) stop();
      saveThenClear();
      setMode(next);
    },
    [mode, isRecording, stop, saveThenClear]
  );

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitText(textValue);
      setTextValue("");
    },
    [submitText, textValue]
  );

  const handleExtractedText = useCallback((text: string) => {
    // OCRは完璧ではないため、自動送信はせずテキスト欄に流し込んで人の目で確認してもらう
    setShowTextInput(true);
    setTextValue((prev) => (prev ? `${prev}\n${text}` : text));
  }, []);

  const meta = MODE_META[mode];

  return (
    <div className="flex h-dvh flex-col bg-gray-50">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">{meta.title}</h1>
          <p className="text-xs text-gray-400">{meta.subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <QrCodeButton />
          <button
            onClick={() => setShowHistory(true)}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
            title="過去の記録"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            onClick={saveThenClear}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
            title="リセット"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {error && (
        <div className="flex shrink-0 items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ファーストビュー: モード切替 + 録音ボタン(タイムラインを広く見せるためコンパクトにまとめる) */}
      <div className="flex shrink-0 flex-col items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="grid w-full max-w-sm grid-cols-2 gap-2">
          <button
            onClick={() => changeMode("meeting")}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === "meeting" ? "bg-gray-900 text-white shadow-sm" : "bg-gray-100 text-gray-500"
            }`}
          >
            議事録モード
          </button>
          <button
            onClick={() => changeMode("karte")}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === "karte" ? "bg-gray-900 text-white shadow-sm" : "bg-gray-100 text-gray-500"
            }`}
          >
            通院カルテモード
          </button>
        </div>

        {inAppBrowser && <InAppBrowserBanner appName={inAppBrowser} onOpenGuide={() => setShowInAppGuide(true)} />}
        {!inAppBrowser && isBrave && showBraveNotice && (
          <BraveNotice onDismiss={() => setShowBraveNotice(false)} />
        )}

        <div className="flex w-full max-w-sm items-center gap-3">
          <button
            onClick={isRecording ? stop : start}
            disabled={recordingBlocked}
            aria-label={isRecording ? "録音を停止" : "録音を開始"}
            title={inAppBrowser ? "アプリ内ブラウザでは録音できません" : undefined}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-md transition-all active:scale-95 disabled:opacity-40 ${
              isRecording ? "bg-red-600 hover:bg-red-700" : "bg-gray-900 hover:bg-gray-700"
            }`}
          >
            {isRecording ? <Square className="h-5 w-5 text-white" /> : <Mic className="h-6 w-6 text-white" />}
          </button>
          <div className="min-w-0">
            <p
              className={`flex items-center gap-1.5 text-sm font-medium ${
                isRecording ? "text-red-600" : "text-gray-500"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isRecording ? "animate-pulse bg-red-600" : "bg-gray-300"}`} />
              {isRecording ? "録音中…" : "待機中"}
            </p>
            <p className="text-xs text-gray-400">
              {inAppBrowser
                ? "この画面では録音できません"
                : isRecording
                  ? "タップして停止"
                  : "タップして録音開始"}
            </p>
            {status && <p className="text-xs text-gray-400">{status}</p>}
          </div>
        </div>

        <div className="flex w-full max-w-sm flex-wrap items-start justify-center gap-x-4 gap-y-1">
          <button
            onClick={() => setShowTextInput((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 underline underline-offset-2"
          >
            <Keyboard className="h-3.5 w-3.5" />
            {showTextInput ? "キーボード入力を閉じる" : "キーボードで入力"}
          </button>

          <DocumentScanInput onExtractedText={handleExtractedText} />
        </div>

        {showTextInput && (
          <form onSubmit={handleTextSubmit} className="flex w-full max-w-sm items-end gap-2">
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="内容を入力(写真読み取り結果もここに入ります)…"
              rows={textValue.includes("\n") ? 4 : 1}
              className="min-w-0 flex-1 resize-y rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={!textValue.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>

      {/* モバイル用タブ切り替え */}
      <div className="flex shrink-0 border-b border-gray-200 bg-white md:hidden">
        <button
          onClick={() => setMobileTab("timeline")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium ${
            mobileTab === "timeline" ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400"
          }`}
        >
          <MessagesSquare className="h-4 w-4" /> タイムライン
        </button>
        <button
          onClick={() => setMobileTab("insight")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium ${
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
          <InsightPanel utterances={utterances} onToggleTodo={toggleTodo} mode={mode} />
        </section>
      </main>

      {inAppBrowser && showInAppGuide && (
        <InAppBrowserOverlay appName={inAppBrowser} onDismiss={() => setShowInAppGuide(false)} />
      )}

      {showHistory && <HistoryView mode={mode} onClose={() => setShowHistory(false)} />}
    </div>
  );
}
