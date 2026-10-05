"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import type { Speaker, TranscriptSegment } from "@/lib/types";
import { useAudioCapture } from "@/lib/useAudioCapture";

const speakerLabel: Record<Speaker, string> = {
  doctor: "医師",
  patient: "患者",
  staff: "スタッフ",
  unknown: "話者不明",
};

const MAX_AUTO_RECONNECT_ATTEMPTS = 3;

export default function TranscriptPanel({
  sessionId,
  initialTranscript,
  onNewFinalSegment,
}: {
  sessionId: string;
  initialTranscript: TranscriptSegment[];
  onNewFinalSegment?: () => void;
}) {
  const [segments, setSegments] = useState<TranscriptSegment[]>(initialTranscript);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [manualSpeaker, setManualSpeaker] = useState<Speaker>("patient");
  const [manualText, setManualText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);

  const connect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setConnectionError(null);
    const ws = new WebSocket(api.wsUrl(sessionId));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "transcript_delta" && msg.is_final) {
        setSegments((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            speaker: (msg.speaker as Speaker) || "unknown",
            text: msg.text,
            is_final: true,
            timestamp: new Date().toISOString(),
          },
        ]);
        onNewFinalSegment?.();
      } else if (msg.type === "error") {
        // サーバーからの音声処理エラー通知。fatal時は接続が切られる前提で再接続を促す
        reportError(new Error(msg.message), { sessionId, fatal: msg.fatal, source: "audio_ws" });
        setConnectionError(msg.message);
      }
    };

    ws.onerror = (event) => {
      reportError(new Error("WebSocket error"), { sessionId, event: String(event) });
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (intentionalCloseRef.current) return;

      // 意図しない切断は、短い間隔で自動再接続を試みる。それでも繋がらない場合は
      // ユーザーが「再接続」ボタンで手動再試行できるようにする（下のUIで表示）。
      if (reconnectAttemptsRef.current < MAX_AUTO_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        const delay = 1000 * reconnectAttemptsRef.current;
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        setConnectionError("音声認識サーバーとの接続が切れました。手動で再接続してください。");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    intentionalCloseRef.current = false;
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleManualReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  const { isRecording, error: micError, start, stop } = useAudioCapture((base64) => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: "audio_chunk", audio: base64 }));
  });

  function sendManualText() {
    if (!manualText.trim()) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "manual_text", speaker: manualSpeaker, text: manualText })
      );
    } else {
      api
        .addManualTranscript(sessionId, manualSpeaker, manualText)
        .then((s) => {
          setSegments(s.transcript);
          onNewFinalSegment?.();
        })
        .catch((e) => reportError(e, { sessionId, action: "manual-transcript-fallback" }));
    }
    setManualText("");
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">リアルタイム議事録</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            connected ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-500"
          }`}
        >
          {connected ? "接続中" : "未接続"}
        </span>
      </div>

      {connectionError && (
        <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <p className="text-xs text-amber-800 flex-1">{connectionError}</p>
          {!connected && (
            <button
              onClick={handleManualReconnect}
              className="text-xs font-medium text-clinic-accent underline shrink-0"
            >
              再接続
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 mb-3 max-h-80 min-h-[10rem] border border-gray-100 rounded-md p-2 bg-gray-50">
        {segments.length === 0 && (
          <p className="text-gray-400 text-sm">まだ発言がありません。マイクを開始するか、下のフォームから発言を追加してください。</p>
        )}
        {segments.map((seg) => (
          <div key={seg.id} className="text-sm">
            <span className="font-medium text-clinic-primary">{speakerLabel[seg.speaker]}: </span>
            <span>{seg.text}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-2">
        <button
          onClick={isRecording ? stop : start}
          className={`px-3 py-1.5 rounded-md text-sm font-medium text-white ${
            isRecording ? "bg-clinic-danger" : "bg-clinic-accent"
          }`}
        >
          {isRecording ? "マイク停止" : "マイク開始"}
        </button>
        {micError && <span className="text-xs text-clinic-danger self-center">{micError}</span>}
      </div>

      <div className="flex gap-2">
        <select
          value={manualSpeaker}
          onChange={(e) => setManualSpeaker(e.target.value as Speaker)}
          className="border border-gray-300 rounded-md text-sm px-2"
        >
          <option value="doctor">医師</option>
          <option value="patient">患者</option>
          <option value="staff">スタッフ</option>
        </select>
        <input
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendManualText()}
          placeholder="手動入力（マイクなしモード / デモ用）"
          className="flex-1 border border-gray-300 rounded-md text-sm px-2 py-1"
        />
        <button
          onClick={sendManualText}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-clinic-primary text-white"
        >
          追加
        </button>
      </div>
    </div>
  );
}
