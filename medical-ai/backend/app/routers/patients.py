from fastapi import APIRouter

from app.data import store
from app.models import ConsultationSession, Patient

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("", response_model=list[Patient])
def get_patients() -> list[Patient]:
    return store.list_patients()


@router.post("/{patient_id}/sessions", response_model=ConsultationSession)
def start_session(patient_id: str) -> ConsultationSession:
    return store.create_session(patient_id)
