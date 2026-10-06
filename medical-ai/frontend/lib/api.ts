import type {
  ComplianceCheckResult,
  ConsultationSession,
  DrugSuggestionResult,
  FeatureFlags,
  HandoffRecord,
  HandoffTarget,
  Patient,
  PhysicianProfile,
  PrescriptionOrder,
  ReferralLetter,
  SoapNote,
} from "./types";
import { reportError } from "./monitoring";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

// サーバー側が「一時的に混雑/不安定」と明示しているステータス(503=AI生成の一時失敗, 429=レート制限)
// に限り、1回だけ静かに再試行する。それ以外(400/404等)は再試行しても無駄なので即座に失敗させる。
const SILENTLY_RETRYABLE_STATUSES = new Set([429, 503]);
const SILENT_RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed.detail || parsed.error || body;
    } catch {
      // JSONでなければそのままの本文を使う
    }
    throw new ApiError(res.status, message || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await requestOnce<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && SILENTLY_RETRYABLE_STATUSES.has(e.status)) {
      await sleep(SILENT_RETRY_DELAY_MS);
      try {
        return await requestOnce<T>(path, init);
      } catch (e2) {
        reportError(e2, { path, retried: true });
        throw e2;
      }
    }
    reportError(e, { path, retried: false });
    throw e;
  }
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

  getFeatures: () => request<FeatureFlags>("/api/features"),

  // 表示専用。処方オーダには保存・反映されない(採用するかは医師が手入力で決める)
  suggestDrugs: (sessionId: string) =>
    request<DrugSuggestionResult>(`/api/sessions/${sessionId}/prescription/drug-suggestions`, {
      method: "POST",
    }),

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
