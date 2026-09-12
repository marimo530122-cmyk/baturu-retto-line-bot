from fastapi import APIRouter

from app.data import store
from app.models import HandoffIn, HandoffRecord, SessionStatus

router = APIRouter(prefix="/api", tags=["handoff"])


@router.post("/sessions/{session_id}/handoff", response_model=HandoffRecord)
def send_handoff(session_id: str, body: HandoffIn) -> HandoffRecord:
    session = store.get_session(session_id)
    patient = store.get_patient(session.patient_id)

    record = HandoffRecord(
        session_id=session_id,
        patient_name=patient.name,
        targets=body.targets,
        note=body.note,
    )
    store.add_handoff(record)

    session.status = SessionStatus.SENT
    store.save_session(session)
    return record


@router.get("/handoff/outbox", response_model=list[HandoffRecord])
def get_outbox() -> list[HandoffRecord]:
    """看護師/調剤側のダッシュボードが参照する連携済みデータ一覧。"""
    return store.list_handoff_outbox()
