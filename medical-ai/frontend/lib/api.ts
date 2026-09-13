import type {
  ComplianceCheckResult,
  ConsultationSession,
  HandoffRecord,
  HandoffTarget,
  Patient,
  PhysicianProfile,
  PrescriptionOrder,
  ReferralLetter,
  SoapNote,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listPatients: () => request<Patient[]>("/api/patients"),

  startSession: (patientId: string) =>
    request<ConsultationSession>(`/api/patients/${patientId}/sessions`, {
      method: "POST",
    }),

  getSession: (sessionId: string) =>
    request<ConsultationSession>(`/api/sessions/${sessionId}`),

  addManualTranscript: (sessionId: string, speaker: string, text: string) =>
    request<ConsultationSession>(`/api/sessions/${sessionId}/transcript/manual`, {
      method: "POST",
      body: JSON.stringify({ speaker, text }),
    }),

  finalizeSession: (sessionId: string) =>
    request<ConsultationSession>(`/api/sessions/${sessionId}/finalize`, {
      method: "POST",
    }),

  refreshPrescription: (sessionId: string) =>
    request<ConsultationSession>(`/api/sessions/${sessionId}/prescription/refresh`, {
      method: "POST",
    }),

  refreshLiveDraft: (sessionId: string) =>
    request<ConsultationSession>(`/api/sessions/${sessionId}/live-draft/refresh`, {
      method: "POST",
    }),

  getPhysicianProfile: () => request<PhysicianProfile>("/api/physician-profile"),

  updatePhysicianProfile: (styleNotes: string) =>
    request<PhysicianProfile>("/api/physician-profile", {
      method: "PUT",
      body: JSON.stringify({ style_notes: styleNotes }),
    }),

  updateSoap: (sessionId: string, patch: Partial<SoapNote>) =>
    request<SoapNote>(`/api/sessions/${sessionId}/soap`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  updateReferral: (sessionId: string, patch: Partial<ReferralLetter>) =>
    request<ReferralLetter>(`/api/sessions/${sessionId}/referral`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  updatePrescription: (sessionId: string, patch: Partial<PrescriptionOrder>) =>
    request<PrescriptionOrder>(`/api/sessions/${sessionId}/prescription`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  checkCompliance: (sessionId: string, requestedDaysSupply?: number) =>
    request<ComplianceCheckResult>(
      `/api/sessions/${sessionId}/prescription/compliance-check`,
      {
        method: "POST",
        body: JSON.stringify({ requested_days_supply: requestedDaysSupply ?? null }),
      }
    ),

  sendHandoff: (sessionId: string, targets: HandoffTarget[], note: string) =>
    request<HandoffRecord>(`/api/sessions/${sessionId}/handoff`, {
      method: "POST",
      body: JSON.stringify({ targets, note }),
    }),

  getHandoffOutbox: () => request<HandoffRecord[]>("/api/handoff/outbox"),

  wsUrl: (sessionId: string) => {
    const base = API_BASE.replace(/^http/, "ws");
    return `${base}/api/sessions/${sessionId}/audio`;
  },
};
