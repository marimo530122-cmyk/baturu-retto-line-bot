"""議事録 -> SOAPカルテ / 紹介状 / 処方オーダ を生成するパイプライン。

OPENAI_API_KEY が設定されている場合は OpenAI Chat Completions (JSON Schema による
構造化出力) を使用する。未設定の場合は、UIの一気通貫フローを確認できるよう
`[MOCK]` 付きの簡易生成物を返す。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from app.config import Settings
from app.models import (
    ConsultationSession,
    PrescriptionItem,
    PrescriptionOrder,
    ReferralLetter,
    SoapNote,
)
from app.prompts import (
    MINUTES_SYSTEM_PROMPT,
    PRESCRIPTION_SYSTEM_PROMPT,
    REFERRAL_SYSTEM_PROMPT,
    SOAP_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)


def _transcript_text(session: ConsultationSession) -> str:
    lines = []
    for seg in session.transcript:
        if not seg.is_final:
            continue
        speaker_label = {
            "doctor": "医師",
            "patient": "患者",
            "staff": "スタッフ",
            "unknown": "話者不明",
        }.get(seg.speaker.value if hasattr(seg.speaker, "value") else seg.speaker, "話者不明")
        lines.append(f"{speaker_label}: {seg.text}")
    return "\n".join(lines)


async def _chat_json(settings: Settings, system_prompt: str, user_content: str, schema_name: str, schema: dict) -> dict:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema, "strict": True},
        },
    )
    content = response.choices[0].message.content
    return json.loads(content)


async def generate_minutes(settings: Settings, session: ConsultationSession) -> str:
    transcript = _transcript_text(session)
    if not transcript.strip():
        return ""
    if settings.mock_mode:
        return "[MOCK] 議事録:\n" + transcript
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": MINUTES_SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
    )
    return response.choices[0].message.content or ""


SOAP_SCHEMA = {
    "type": "object",
    "properties": {
        "subjective": {"type": "string"},
        "objective": {"type": "string"},
        "assessment": {"type": "string"},
        "plan": {"type": "string"},
    },
    "required": ["subjective", "objective", "assessment", "plan"],
    "additionalProperties": False,
}


async def generate_soap(settings: Settings, session: ConsultationSession) -> SoapNote:
    transcript = _transcript_text(session)
    if settings.mock_mode or not transcript.strip():
        return SoapNote(
            subjective="[MOCK] 患者の自覚症状（議事録より要約予定）",
            objective="[MOCK] 診察所見（議事録より要約予定）",
            assessment="[MOCK] 医師が言及した評価・診断",
            plan="[MOCK] 治療方針・処方・フォローアップ",
            generated_at=datetime.utcnow(),
            is_mock=True,
        )
    data = await _chat_json(settings, SOAP_SYSTEM_PROMPT, transcript, "soap_note", SOAP_SCHEMA)
    return SoapNote(**data, generated_at=datetime.utcnow(), is_mock=False)


REFERRAL_SCHEMA = {
    "type": "object",
    "properties": {
        "to_institution": {"type": "string"},
        "to_department": {"type": "string"},
        "reason_for_referral": {"type": "string"},
        "clinical_summary": {"type": "string"},
        "current_treatment": {"type": "string"},
        "requested_action": {"type": "string"},
    },
    "required": [
        "to_institution",
        "to_department",
        "reason_for_referral",
        "clinical_summary",
        "current_treatment",
        "requested_action",
    ],
    "additionalProperties": False,
}


async def generate_referral(settings: Settings, session: ConsultationSession) -> ReferralLetter:
    transcript = _transcript_text(session)
    if settings.mock_mode or not transcript.strip():
        return ReferralLetter(
            to_institution="[MOCK] 紹介先医療機関名（要確認）",
            to_department="[MOCK] 診療科",
            reason_for_referral="[MOCK] 紹介理由",
            clinical_summary=session.soap.assessment or "[MOCK] 臨床経過の要約",
            current_treatment="[MOCK] 現在の治療内容",
            requested_action="[MOCK] 依頼事項（精査・加療等）",
            generated_at=datetime.utcnow(),
            is_mock=True,
        )
    user_content = f"# 議事録\n{transcript}\n\n# SOAPカルテ\n{session.soap.model_dump_json()}"
    data = await _chat_json(settings, REFERRAL_SYSTEM_PROMPT, user_content, "referral_letter", REFERRAL_SCHEMA)
    return ReferralLetter(**data, generated_at=datetime.utcnow(), is_mock=False)


PRESCRIPTION_SCHEMA = {
    "type": "object",
    "properties": {
        "diagnosis": {"type": "string"},
        "patient_request_note": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "drug_name": {"type": "string"},
                    "dosage": {"type": "string"},
                    "frequency": {"type": "string"},
                    "days_supply": {"type": "integer"},
                    "quantity": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": ["drug_name", "dosage", "frequency", "days_supply", "quantity", "notes"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["diagnosis", "patient_request_note", "items"],
    "additionalProperties": False,
}


async def extract_prescription(settings: Settings, session: ConsultationSession) -> PrescriptionOrder:
    transcript = _transcript_text(session)
    if settings.mock_mode or not transcript.strip():
        return PrescriptionOrder(
            diagnosis="[MOCK] 医師が議事録で言及した診断名がここに入ります",
            patient_request_note="[MOCK] 患者からの投薬数量・日数の要望",
            items=[
                PrescriptionItem(
                    drug_name="[MOCK] 薬剤名",
                    dosage="1回1錠",
                    frequency="1日1回 朝食後",
                    days_supply=14,
                    quantity="14錠",
                    notes="[MOCK] 議事録からの自動抽出結果（要確認）",
                )
            ],
            generated_at=datetime.utcnow(),
            is_mock=True,
        )
    data = await _chat_json(settings, PRESCRIPTION_SYSTEM_PROMPT, transcript, "prescription_order", PRESCRIPTION_SCHEMA)
    items = [PrescriptionItem(**item) for item in data.get("items", [])]
    return PrescriptionOrder(
        diagnosis=data.get("diagnosis", ""),
        patient_request_note=data.get("patient_request_note", ""),
        items=items,
        generated_at=datetime.utcnow(),
        is_mock=False,
    )


async def run_full_pipeline(settings: Settings, session: ConsultationSession) -> None:
    """finalize時に呼ばれ、議事録・SOAP・紹介状・処方オーダをまとめて生成し session に反映する。"""
    session.minutes = await generate_minutes(settings, session)
    session.soap = await generate_soap(settings, session)
    session.referral = await generate_referral(settings, session)
    session.prescription = await extract_prescription(settings, session)
