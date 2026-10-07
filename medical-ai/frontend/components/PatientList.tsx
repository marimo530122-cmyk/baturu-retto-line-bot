"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Patient } from "@/lib/types";
import { useCurrentUser } from "./AuthShell";

const statusLabel: Record<Patient["status"], string> = {
  waiting: "受付済み",
  in_session: "診察中",
  done: "診察完了",
};

const statusColor: Record<Patient["status"], string> = {
  waiting: "bg-gray-100 text-gray-700",
  in_session: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
};

export default function PatientList() {
  const router = useRouter();
  const user = useCurrentUser();
  const isDoctor = user.role === "doctor";
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPatients()
      .then(setPatients)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // 看護師は新しい診察を始められないので、その患者の最新の記録を開く
  async function handleOpenLatest(patientId: string) {
    setStartingId(patientId);
    setError(null);
    try {
      const sessions = await api.listPatientSessions(patientId);
      if (sessions.length === 0) {
        setError("この患者さんの診察記録はまだありません。");
        setStartingId(null);
        return;
      }
      router.push(`/session/${sessions[0].id}`);
    } catch (e) {
      setError(String(e));
      setStartingId(null);
    }
  }

  async function handleStart(patientId: string) {
    setStartingId(patientId);
    try {
      const session = await api.startSession(patientId);
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError(String(e));
      setStartingId(null);
    }
  }

  if (loading) return <p className="text-gray-500">読み込み中...</p>;
  if (error && patients.length === 0)
    return (
      <p className="text-clinic-danger">
        エラー: {error}（バックエンドAPI (NEXT_PUBLIC_API_BASE) が起動しているか確認してください）
      </p>
    );

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">本日の受付患者一覧</h2>
      {error && <p className="text-sm text-clinic-danger mb-3">{error}</p>}
      <div className="grid gap-3">
        {patients.map((p) => (
          <div
            key={p.id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-lg">{p.name}</span>
                <span className="text-sm text-gray-400">{p.name_kana}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[p.status]}`}>
                  {statusLabel[p.status]}
                </span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {p.scheduled_time} ・ {p.department} ・ {p.sex} ・ {p.birth_date}
              </div>
              <div className="text-sm text-gray-700 mt-1">主訴: {p.chief_complaint}</div>
            </div>
            <button
              onClick={() => (isDoctor ? handleStart(p.id) : handleOpenLatest(p.id))}
              disabled={startingId === p.id}
              className="shrink-0 bg-clinic-primary hover:bg-clinic-primaryDark text-white font-medium px-4 py-2 rounded-md disabled:opacity-50"
            >
              {startingId === p.id ? "開いています..." : isDoctor ? "診察を開始" : "カルテを見る"}
            </button>
          </div>
        ))}
        {patients.length === 0 && (
          <p className="text-gray-500">本日の受付患者はいません。</p>
        )}
      </div>
    </div>
  );
}
