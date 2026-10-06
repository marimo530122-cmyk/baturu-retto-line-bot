from fastapi import APIRouter, HTTPException

from app.config import get_settings

from app.data import store
from app.errors import LlmGenerationError
from app.models import (
    ComplianceCheckIn,
    ComplianceCheckResult,
    DrugSuggestionResult,
    PrescriptionOrder,
    PrescriptionUpdate,
    ReferralLetter,
    ReferralUpdate,
    SoapNote,
    SoapUpdate,
)
from app.services import llm_pipeline
from app.services.prescription_compliance import check_prescription

router = APIRouter(prefix="/api/sessions", tags=["documents"])


@router.get("/{session_id}/soap", response_model=SoapNote)
def get_soap(session_id: str) -> SoapNote:
    return store.get_session(session_id).soap


@router.patch("/{session_id}/soap", response_model=SoapNote)
def update_soap(session_id: str, body: SoapUpdate) -> SoapNote:
    session = store.get_session(session_id)
    for field in body.model_fields_set:
        setattr(session.soap, field, getattr(body, field))
    session.soap.edited = True
    store.save_session(session)
    return session.soap


@router.get("/{session_id}/referral", response_model=ReferralLetter)
def get_referral(session_id: str) -> ReferralLetter:
    return store.get_session(session_id).referral


@router.patch("/{session_id}/referral", response_model=ReferralLetter)
def update_referral(session_id: str, body: ReferralUpdate) -> ReferralLetter:
    session = store.get_session(session_id)
    for field in body.model_fields_set:
        setattr(session.referral, field, getattr(body, field))
    session.referral.edited = True
    store.save_session(session)
    return session.referral


@router.get("/{session_id}/prescription", response_model=PrescriptionOrder)
def get_prescription(session_id: str) -> PrescriptionOrder:
    return store.get_session(session_id).prescription


@router.patch("/{session_id}/prescription", response_model=PrescriptionOrder)
def update_prescription(session_id: str, body: PrescriptionUpdate) -> PrescriptionOrder:
    session = store.get_session(session_id)
    for field in body.model_fields_set:
        setattr(session.prescription, field, getattr(body, field))
    session.prescription.edited = True
    store.save_session(session)
    return session.prescription


@router.post("/{session_id}/prescription/compliance-check", response_model=ComplianceCheckResult)
def compliance_check(session_id: str, body: ComplianceCheckIn) -> ComplianceCheckResult:
    session = store.get_session(session_id)
    return check_prescription(session.prescription, body.requested_days_supply)


@router.post("/{session_id}/prescription/drug-suggestions", response_model=DrugSuggestionResult)
async def drug_suggestions(session_id: str) -> DrugSuggestionResult:
    """SOAPのS/Aから薬剤候補の提案文を生成して返す。

    結果は画面表示用に返すだけで、セッション(処方オーダ)には保存・反映しない。
    候補を採用するかどうか・用量は、医師が処方欄へ自分で入力して決める。
    """
    settings = get_settings()
    if not settings.enable_drug_suggestions:
        raise HTTPException(status_code=404, detail="薬剤候補の提案機能は無効になっています。")
    session = store.get_session(session_id)
    try:
        return await llm_pipeline.suggest_drugs(settings, session)
    except LlmGenerationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
