"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { ConsultationSession } from "@/lib/types";
import TranscriptPanel from "@/components/TranscriptPanel";
import SoapEditor from "@/components/SoapEditor";
import ReferralLetterEditor from "@/components/ReferralLetterEditor";
import PrescriptionPanel from "@/components/PrescriptionPanel";
import StaffHandoffBar from "@/components/StaffHandoffBar";

const statusLabel: Record<ConsultationSession["status"], string> = {
  in_progress: "診察中",
  generating: "カルテ生成中...",
  review: "医師確認待ち",
  sent: "スタッフ連携済み",
};

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params.id;

  const [session, setSession] = useState<ConsultationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // 対話中に処方オーダをライブで自動構築する（発言追加のたびにデバウンスして再抽出）
  const handleNewFinalSegment = useCallback(() => {
    if (refreshDebounce.current) clearTimeout(refreshDebounce.current);
    refreshDebounce.current = setTimeout(async () => {
      try {
        const updated = await api.refreshPrescription(sessionId);
        setSession(updated);
      } catch {
        // ライブ更新の失敗は致命的ではないため握りつぶす（finalize時に再生成される）
      }
    }, 2500);
  }, [sessionId]);

  async function handleFinalize() {
    setFinalizing(true);
    try {
      const updated = await api.finalizeSession(sessionId);
      setSession(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) return <p className="text-gray-500">読み込み中...</p>;
  if (error || !session)
    return <p className="text-clinic-danger">エラー: {error}</p>;

  const canHandoff = session.status === "review" || session.status === "sent";
  const liveUpdating = session.status === "in_progress" && !session.prescription.edited;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/")} className="text-sm text-clinic-accent">
          ← 受付リストへ戻る
        </button>
        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 font-medium">
          {statusLabel[session.status]}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <TranscriptPanel
          sessionId={sessionId}
          initialTranscript={session.transcript}
          onNewFinalSegment={handleNewFinalSegment}
        />
        <PrescriptionPanel
          sessionId={sessionId}
          prescription={session.prescription}
          liveUpdating={liveUpdating}
          onChange={(prescription) => setSession({ ...session, prescription })}
        />
      </div>

      {session.status === "in_progress" && (
        <button
          onClick={handleFinalize}
          disabled={finalizing}
          className="w-full bg-clinic-accent text-white font-semibold py-3 rounded-md disabled:opacity-50"
        >
          {finalizing ? "議事録・カルテ・紹介状を生成中..." : "診察を終了してカルテ一式を生成"}
        </button>
      )}

      {(session.status === "review" || session.status === "sent") && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <SoapEditor
              sessionId={sessionId}
              soap={session.soap}
              onChange={(soap) => setSession({ ...session, soap })}
            />
            <ReferralLetterEditor
              sessionId={sessionId}
              referral={session.referral}
              onChange={(referral) => setSession({ ...session, referral })}
            />
          </div>

          <StaffHandoffBar
            sessionId={sessionId}
            disabled={!canHandoff}
            onSent={() => setSession({ ...session, status: "sent" })}
          />
        </>
      )}
    </div>
  );
}
