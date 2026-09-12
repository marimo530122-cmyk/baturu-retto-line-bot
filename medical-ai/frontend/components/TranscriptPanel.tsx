"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Speaker, TranscriptSegment } from "@/lib/types";
import { useAudioCapture } from "@/lib/useAudioCapture";

const speakerLabel: Record<Speaker, string> = {
  doctor: "医師",
  patient: "患者",
  staff: "スタッフ",
  unknown: "話者不明",
};

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
  const [manualSpeaker, setManualSpeaker] = useState<Speaker>("patient");
  const [manualText, setManualText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(api.wsUrl(sessionId));
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
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
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
      api.addManualTranscript(sessionId, manualSpeaker, manualText).then((s) => {
        setSegments(s.transcript);
        onNewFinalSegment?.();
      });
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
