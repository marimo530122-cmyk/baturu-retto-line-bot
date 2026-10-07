from fastapi import APIRouter, Depends

from app.data import store
from app.deps import CLINICAL_STAFF, DOCTOR_ONLY, require_roles
from app.models import ConsultationSession, Patient

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("", response_model=list[Patient], dependencies=[Depends(require_roles(*CLINICAL_STAFF))])
def get_patients() -> list[Patient]:
    return store.list_patients()


@router.post("/{patient_id}/sessions", response_model=ConsultationSession, dependencies=[Depends(require_roles(*DOCTOR_ONLY))])
def start_session(patient_id: str) -> ConsultationSession:
    return store.create_session(patient_id)


@router.get(
    "/{patient_id}/sessions",
    response_model=list[ConsultationSession],
    dependencies=[Depends(require_roles(*CLINICAL_STAFF))],
)
def list_patient_sessions(patient_id: str) -> list[ConsultationSession]:
    """その患者の診察記録(新しい順)。看護師が最新のカルテを開くときに使う。"""
    store.get_patient(patient_id)
    return store.list_sessions_for_patient(patient_id)
