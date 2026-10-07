"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import type { ConsultationSession } from "@/lib/types";
import TranscriptPanel from "@/components/TranscriptPanel";
import SoapEditor from "@/components/SoapEditor";
import ReferralLetterEditor from "@/components/ReferralLetterEditor";
import PrescriptionPanel from "@/components/PrescriptionPanel";
import StaffHandoffBar from "@/components/StaffHandoffBar";
import LiveDraftPreview from "@/components/LiveDraftPreview";
import PhysicianProfileEditor from "@/components/PhysicianProfileEditor";
import { useCurrentUser } from "@/components/AuthShell";

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
  // 看護師は閲覧と会話の手入力だけ(カルテ・処方の修正や確定、送信は医師のみ。サーバー側でも禁止している)
  const isDoctor = useCurrentUser().role === "doctor";

  const [session, setSession] = useState<ConsultationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveUpdateNotice, setLiveUpdateNotice] = useState<string | null>(null);
  const refreshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveUpdateNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSession = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getSession(sessionId)
      .then(setSession)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // 対話中に処方オーダ・アンビエントスクライブのライブプレビューを自動構築する
  // （発言追加のたびにデバウンスして再抽出。手動入力は一切不要）
  const handleNewFinalSegment = useCallback(() => {
    if (!isDoctor) return; // 自動更新(AI生成)は医師の操作として行う
    if (refreshDebounce.current) clearTimeout(refreshDebounce.current);
    refreshDebounce.current = setTimeout(async () => {
      try {
        await api.refreshPrescription(sessionId);
        const updated = await api.refreshLiveDraft(sessionId);
        setSession(updated);
      } catch (e) {
        // ライブ更新の失敗自体は致命的ではない（次の発言で自動的に再試行される・
        // finalize時にも再生成される）ため会話は止めないが、記録と軽い通知は行う
        reportError(e, { sessionId, action: "live-update" });
        setLiveUpdateNotice("自動更新に失敗しました(次の発言で自動的に再試行します)");
        if (liveUpdateNoticeTimer.current) clearTimeout(liveUpdateNoticeTimer.current);
        liveUpdateNoticeTimer.current = setTimeout(() => setLiveUpdateNotice(null), 4000);
      }
    }, 2500);
  }, [sessionId, isDoctor]);

  async function handleFinalize() {
    setFinalizing(true);
    setError(null);
    try {
      const updated = await api.finalizeSession(sessionId);
      setSession(updated);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) return <p className="text-gray-500">読み込み中...</p>;
  if (error && !session)
    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-3">
        <p className="text-clinic-danger">エラー: {error}</p>
        <button
          onClick={loadSession}
          className="bg-clinic-accent text-white font-medium px-4 py-2 rounded-md"
        >
          再試行
        </button>
      </div>
    );
  if (!session) return null;

  const canHandoff = session.status === "review" || session.status === "sent";
  // 自動更新は医師の画面からだけ行うので、看護師の画面には「自動構築中」を出さない
  const liveUpdating = isDoctor && session.status === "in_progress" && !session.prescription.edited;

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

      {!isDoctor && (
        <p className="text-sm bg-blue-50 border border-blue-200 text-blue-900 rounded-md px-3 py-2">
          看護師アカウントでは閲覧のみです(会話の手入力はできます)。カルテや処方の修正・確定は医師が行います。
        </p>
      )}

      {isDoctor && session.status === "in_progress" && <PhysicianProfileEditor />}

      {liveUpdateNotice && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          {liveUpdateNotice}
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <TranscriptPanel
          sessionId={sessionId}
          initialTranscript={session.transcript}
          onNewFinalSegment={handleNewFinalSegment}
        />
        <fieldset disabled={!isDoctor} className="min-w-0">
          <PrescriptionPanel
            sessionId={sessionId}
            prescription={session.prescription}
            liveUpdating={liveUpdating}
            onChange={(prescription) => setSession({ ...session, prescription })}
          />
        </fieldset>
      </div>

      {session.status === "in_progress" && (
        <LiveDraftPreview liveDraft={session.live_draft} liveUpdating={liveUpdating} />
      )}

      {isDoctor && session.status === "in_progress" && (
        <div className="space-y-2">
          {error && (
            <p className="text-sm text-clinic-danger bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="w-full bg-clinic-accent text-white font-semibold py-3 rounded-md disabled:opacity-50"
          >
            {finalizing
              ? "議事録・カルテ・紹介状を生成中..."
              : error
                ? "再試行: カルテ一式を生成"
                : "診察を終了してカルテ一式を生成"}
          </button>
        </div>
      )}

      {(session.status === "review" || session.status === "sent") && (
        <>
          <fieldset disabled={!isDoctor} className="grid md:grid-cols-2 gap-4 min-w-0">
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
          </fieldset>

          {isDoctor && (
            <StaffHandoffBar
              sessionId={sessionId}
              disabled={!canHandoff}
              onSent={() => setSession({ ...session, status: "sent" })}
            />
          )}
        </>
      )}
    </div>
  );
}
