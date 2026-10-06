export type PatientStatus = "waiting" | "in_session" | "done";

export interface Patient {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  sex: string;
  department: string;
  scheduled_time: string;
  chief_complaint: string;
  status: PatientStatus;
}

export type SessionStatus = "in_progress" | "generating" | "review" | "sent";
export type Speaker = "doctor" | "patient" | "staff" | "unknown";

export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  text: string;
  is_final: boolean;
  timestamp: string;
}

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  generated_at: string | null;
  edited: boolean;
  is_mock: boolean;
}

export interface ReferralLetter {
  to_institution: string;
  to_department: string;
  reason_for_referral: string;
  clinical_summary: string;
  current_treatment: string;
  requested_action: string;
  generated_at: string | null;
  edited: boolean;
  is_mock: boolean;
}

export interface PrescriptionItem {
  drug_name: string;
  dosage: string;
  frequency: string;
  days_supply: number;
  quantity: string;
  notes: string;
}

export interface PrescriptionOrder {
  diagnosis: string;
  items: PrescriptionItem[];
  patient_request_note: string;
  generated_at: string | null;
  edited: boolean;
  is_mock: boolean;
}

export interface LiveDraft {
  chief_complaint: string;
  clinical_reasoning: string;
  prescription_draft: string;
  referral_letter: string;
  updated_at: string | null;
  is_mock: boolean;
}

export interface PhysicianProfile {
  style_notes: string;
  updated_at: string | null;
}

export interface ConsultationSession {
  id: string;
  patient_id: string;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  transcript: TranscriptSegment[];
  minutes: string;
  soap: SoapNote;
  referral: ReferralLetter;
  prescription: PrescriptionOrder;
  live_draft: LiveDraft;
}

export type ComplianceSuggestionKind =
  | "existing_diagnosis_exception"
  | "outside_prescription"
  | "split_visit"
  | "self_pay";

export interface ComplianceSuggestion {
  kind: ComplianceSuggestionKind;
  title: string;
  description: string;
  legal_basis: string;
  requires_physician_confirmation: boolean;
}

export interface ComplianceCheckResult {
  triggered: boolean;
  disclaimer: string;
  suggestions: ComplianceSuggestion[];
}

export type HandoffTarget = "nurse" | "pharmacy";

export interface HandoffRecord {
  id: string;
  session_id: string;
  patient_name: string;
  targets: HandoffTarget[];
  note: string;
  sent_at: string;
}
