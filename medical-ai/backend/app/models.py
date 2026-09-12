from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


def _id() -> str:
    return uuid.uuid4().hex[:12]


class PatientStatus(str, Enum):
    WAITING = "waiting"
    IN_SESSION = "in_session"
    DONE = "done"


class Patient(BaseModel):
    id: str
    name: str
    name_kana: str
    birth_date: str
    sex: str
    department: str
    scheduled_time: str
    chief_complaint: str
    status: PatientStatus = PatientStatus.WAITING


class SessionStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    GENERATING = "generating"
    REVIEW = "review"
    SENT = "sent"


class Speaker(str, Enum):
    DOCTOR = "doctor"
    PATIENT = "patient"
    STAFF = "staff"
    UNKNOWN = "unknown"


class TranscriptSegment(BaseModel):
    id: str = Field(default_factory=_id)
    speaker: Speaker = Speaker.UNKNOWN
    text: str
    is_final: bool = True
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class SoapNote(BaseModel):
    subjective: str = ""
    objective: str = ""
    assessment: str = ""
    plan: str = ""
    generated_at: datetime | None = None
    edited: bool = False
    is_mock: bool = False


class ReferralLetter(BaseModel):
    to_institution: str = ""
    to_department: str = ""
    reason_for_referral: str = ""
    clinical_summary: str = ""
    current_treatment: str = ""
    requested_action: str = ""
    generated_at: datetime | None = None
    edited: bool = False
    is_mock: bool = False


class PrescriptionItem(BaseModel):
    drug_name: str
    dosage: str
    frequency: str
    days_supply: int
    quantity: str = ""
    notes: str = ""


class PrescriptionOrder(BaseModel):
    diagnosis: str = ""
    items: list[PrescriptionItem] = Field(default_factory=list)
    patient_request_note: str = ""
    generated_at: datetime | None = None
    edited: bool = False
    is_mock: bool = False


class ComplianceSuggestionKind(str, Enum):
    EXISTING_DIAGNOSIS_EXCEPTION = "existing_diagnosis_exception"
    OUTSIDE_PRESCRIPTION = "outside_prescription"
    SPLIT_VISIT = "split_visit"
    SELF_PAY = "self_pay"


class ComplianceSuggestion(BaseModel):
    kind: ComplianceSuggestionKind
    title: str
    description: str
    legal_basis: str
    requires_physician_confirmation: bool = True


COMPLIANCE_DISCLAIMER = (
    "本提案は、カルテに記録された実際の臨床所見・診断に基づくことを前提とします。"
    "保険適用のためだけに診断名を変更・追加することは、保険診療上の不正請求に該当し得るため行わないでください。"
    "最終的な処方内容の決定は医師の判断で行ってください。"
)


class ComplianceCheckResult(BaseModel):
    triggered: bool
    disclaimer: str = COMPLIANCE_DISCLAIMER
    suggestions: list[ComplianceSuggestion] = Field(default_factory=list)


class HandoffTarget(str, Enum):
    NURSE = "nurse"
    PHARMACY = "pharmacy"


class HandoffRecord(BaseModel):
    id: str = Field(default_factory=_id)
    session_id: str
    patient_name: str
    targets: list[HandoffTarget]
    note: str = ""
    sent_at: datetime = Field(default_factory=datetime.utcnow)


class ConsultationSession(BaseModel):
    id: str = Field(default_factory=_id)
    patient_id: str
    status: SessionStatus = SessionStatus.IN_PROGRESS
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: datetime | None = None
    transcript: list[TranscriptSegment] = Field(default_factory=list)
    minutes: str = ""
    soap: SoapNote = Field(default_factory=SoapNote)
    referral: ReferralLetter = Field(default_factory=ReferralLetter)
    prescription: PrescriptionOrder = Field(default_factory=PrescriptionOrder)


class ManualTranscriptIn(BaseModel):
    speaker: Speaker = Speaker.UNKNOWN
    text: str


class SoapUpdate(BaseModel):
    subjective: str | None = None
    objective: str | None = None
    assessment: str | None = None
    plan: str | None = None


class ReferralUpdate(BaseModel):
    to_institution: str | None = None
    to_department: str | None = None
    reason_for_referral: str | None = None
    clinical_summary: str | None = None
    current_treatment: str | None = None
    requested_action: str | None = None


class PrescriptionUpdate(BaseModel):
    diagnosis: str | None = None
    items: list[PrescriptionItem] | None = None
    patient_request_note: str | None = None


class ComplianceCheckIn(BaseModel):
    requested_days_supply: int | None = None


class HandoffIn(BaseModel):
    targets: list[HandoffTarget]
    note: str = ""
