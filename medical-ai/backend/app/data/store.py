"""プロトタイプ用のインメモリストア。

本番運用では電子カルテ/受付システム・DBに置き換えること。
"""
from __future__ import annotations

from fastapi import HTTPException

from app.models import ConsultationSession, HandoffRecord, Patient, PatientStatus

_patients: dict[str, Patient] = {}
_sessions: dict[str, ConsultationSession] = {}
_handoff_outbox: list[HandoffRecord] = []


def _seed() -> None:
    seed_patients = [
        Patient(
            id="p001",
            name="山田 太郎",
            name_kana="ヤマダ タロウ",
            birth_date="1968-04-12",
            sex="男性",
            department="内科",
            scheduled_time="09:00",
            chief_complaint="咳・微熱が3日間続いている",
        ),
        Patient(
            id="p002",
            name="佐藤 花子",
            name_kana="サトウ ハナコ",
            birth_date="1985-11-02",
            sex="女性",
            department="内科",
            scheduled_time="09:20",
            chief_complaint="不眠が続いており、いつもの薬を1ヶ月分希望",
        ),
        Patient(
            id="p003",
            name="鈴木 一郎",
            name_kana="スズキ イチロウ",
            birth_date="1952-01-30",
            sex="男性",
            department="循環器内科",
            scheduled_time="09:40",
            chief_complaint="動悸・息切れ、専門医紹介の可能性",
        ),
    ]
    for p in seed_patients:
        _patients[p.id] = p


_seed()


def list_patients() -> list[Patient]:
    return list(_patients.values())


def get_patient(patient_id: str) -> Patient:
    patient = _patients.get(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="患者が見つかりません")
    return patient


def create_session(patient_id: str) -> ConsultationSession:
    patient = get_patient(patient_id)
    session = ConsultationSession(patient_id=patient_id)
    _sessions[session.id] = session
    patient.status = PatientStatus.IN_SESSION
    return session


def get_session(session_id: str) -> ConsultationSession:
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="診察セッションが見つかりません")
    return session


def save_session(session: ConsultationSession) -> None:
    _sessions[session.id] = session


def add_handoff(record: HandoffRecord) -> None:
    _handoff_outbox.append(record)


def list_handoff_outbox() -> list[HandoffRecord]:
    return list(reversed(_handoff_outbox))
