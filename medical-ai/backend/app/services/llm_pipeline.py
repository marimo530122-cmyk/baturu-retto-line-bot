"""議事録 -> SOAPカルテ / 紹介状 / 処方オーダ を生成するパイプライン。

OPENAI_API_KEY が設定されている場合は OpenAI Chat Completions (JSON Schema による
構造化出力) を使用する。未設定の場合は、UIの一気通貫フローを確認できるよう
`[MOCK]` 付きの簡易生成物を返す。
"""
from __future__ import annotations

import json
import logging
import unicodedata
from datetime import datetime

from app.config import Settings
from app.errors import call_with_retry
from app.models import (
    ConsultationSession,
    DrugSuggestion,
    DrugSuggestionResult,
    LiveDraft,
    PhysicianProfile,
    PrescriptionItem,
    PrescriptionOrder,
    ReferralLetter,
    SoapNote,
)
from app.prompts import (
    DRUG_SUGGESTION_SYSTEM_PROMPT,
    LIVE_DRAFT_SYSTEM_PROMPT,
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


async def _chat_json(
    settings: Settings, system_prompt: str, user_content: str, schema_name: str, schema: dict, *, stage: str
) -> dict:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def _call() -> dict:
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

    return await call_with_retry(_call, stage=stage)


async def generate_minutes(settings: Settings, session: ConsultationSession) -> str:
    transcript = _transcript_text(session)
    if not transcript.strip():
        return ""
    if settings.mock_mode:
        return "[MOCK] 議事録:\n" + transcript
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def _call() -> str:
        response = await client.chat.completions.create(
            model=settings.chat_model,
            messages=[
                {"role": "system", "content": MINUTES_SYSTEM_PROMPT},
                {"role": "user", "content": transcript},
            ],
        )
        return response.choices[0].message.content or ""

    return await call_with_retry(_call, stage="議事録生成")


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
    data = await _chat_json(settings, SOAP_SYSTEM_PROMPT, transcript, "soap_note", SOAP_SCHEMA, stage="SOAPカルテ生成")
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
    data = await _chat_json(
        settings, REFERRAL_SYSTEM_PROMPT, user_content, "referral_letter", REFERRAL_SCHEMA, stage="紹介状生成"
    )
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
    data = await _chat_json(
        settings,
        PRESCRIPTION_SYSTEM_PROMPT,
        transcript,
        "prescription_order",
        PRESCRIPTION_SCHEMA,
        stage="処方データ抽出",
    )
    items = [PrescriptionItem(**item) for item in data.get("items", [])]
    return PrescriptionOrder(
        diagnosis=data.get("diagnosis", ""),
        patient_request_note=data.get("patient_request_note", ""),
        items=items,
        generated_at=datetime.utcnow(),
        is_mock=False,
    )


DRUG_SUGGESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "drug_name": {"type": "string"},
                    "suggestion_text": {"type": "string"},
                    "rationale": {"type": "string"},
                    "grounding_quote": {"type": "string"},
                    "cautions": {"type": "string"},
                },
                "required": ["drug_name", "suggestion_text", "rationale", "grounding_quote", "cautions"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}

MAX_DRUG_SUGGESTIONS = 3
# これより短い引用は「の」「痛み」のように何にでも一致してしまい根拠確認にならないため認めない
MIN_GROUNDING_QUOTE_CHARS = 4


def _normalize_for_grounding(text: str) -> str:
    """全角/半角・空白・改行の違いだけは吸収して照合する(言い換えは吸収しない)。"""
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(normalized.split())


def is_grounded(quote: str, source_texts: list[str]) -> bool:
    """AIが根拠として引用した文言が、SOAPのS/Aのどちらかに実際に書かれているかを機械的に確認する。
    S末尾とA先頭をまたぐ「つぎはぎ引用」を通さないよう、S/Aは別々に照合する。"""
    q = _normalize_for_grounding(quote)
    if len(q) < MIN_GROUNDING_QUOTE_CHARS:
        return False
    return any(q in _normalize_for_grounding(text) for text in source_texts)


def _is_already_prescribed(drug_name: str, prescribed_names: list[str]) -> bool:
    d = _normalize_for_grounding(drug_name)
    return any(p and (p in d or d in p) for p in (_normalize_for_grounding(n) for n in prescribed_names))


def _filter_drug_suggestions(
    raw: list[dict], source_texts: list[str], prescribed_names: list[str]
) -> tuple[list[DrugSuggestion], int]:
    """根拠を原文で確認できない提案・既に処方済みの薬剤の重複提案を捨てる。"""
    kept: list[DrugSuggestion] = []
    discarded = 0
    for item in raw:
        suggestion = DrugSuggestion(**item)
        if (
            not suggestion.drug_name.strip()
            or not is_grounded(suggestion.grounding_quote, source_texts)
            or _is_already_prescribed(suggestion.drug_name, prescribed_names)
        ):
            discarded += 1
            continue
        kept.append(suggestion)
    if len(kept) > MAX_DRUG_SUGGESTIONS:
        discarded += len(kept) - MAX_DRUG_SUGGESTIONS
        kept = kept[:MAX_DRUG_SUGGESTIONS]
    return kept, discarded


async def suggest_drugs(settings: Settings, session: ConsultationSession) -> DrugSuggestionResult:
    """SOAPのS/Aから薬剤候補の「提案文」を生成する。

    処方適正化アドバイザーと同じく安全側の設計:
    - 結果は表示用に返すだけで、session.prescription には一切書き込まない(自動入力しない)。
    - 用量・日数は生成させない(用量決定は医師が行う)。
    - S/Aからの一字一句の引用(grounding_quote)を必須とし、原文に無い引用の提案は捨てる
      (議事録に無い症状・診断を創作して根拠にすることを機械的に防ぐ)。
    - 診断名の提案・変更はさせない(プロンプトで禁止)。
    """
    subjective = session.soap.subjective.strip()
    assessment = session.soap.assessment.strip()
    base = DrugSuggestionResult(
        basis_subjective=subjective,
        basis_assessment=assessment,
        generated_at=datetime.utcnow(),
        is_mock=settings.mock_mode,
    )
    if not subjective and not assessment:
        base.notice = "SOAPカルテのS(主観的情報)・A(評価)が空のため、提案できません。先にSOAPカルテを作成してください。"
        return base

    source_texts = [subjective, assessment]
    prescribed_names = [item.drug_name for item in session.prescription.items]

    if settings.mock_mode:
        quote = (subjective or assessment)[:20]
        raw = [
            {
                "drug_name": "[MOCK] 候補薬剤名",
                "suggestion_text": "[MOCK] ○○(一般名)はいかがでしょうか。",
                "rationale": "[MOCK] 引用した症状・診断と薬剤を結びつける一般的な理由がここに入ります。",
                "grounding_quote": quote,
                "cautions": "[MOCK] 薬物アレルギー・併用薬の有無を確認",
            }
        ]
    else:
        prescribed = "、".join(n for n in prescribed_names if n.strip()) or "なし"
        user_content = (
            f"# S(主観的情報)\n{subjective or '(記載なし)'}\n\n"
            f"# A(評価)\n{assessment or '(記載なし)'}\n\n"
            f"# 既に処方済みの薬剤\n{prescribed}"
        )
        data = await _chat_json(
            settings,
            DRUG_SUGGESTION_SYSTEM_PROMPT,
            user_content,
            "drug_suggestions",
            DRUG_SUGGESTION_SCHEMA,
            stage="薬剤候補の提案",
        )
        raw = data.get("suggestions", [])

    base.suggestions, base.discarded_count = _filter_drug_suggestions(raw, source_texts, prescribed_names)
    if base.discarded_count:
        logger.info("薬剤候補の提案のうち %d 件を除外しました(根拠の引用が原文に無い/処方済み等)", base.discarded_count)
    if not base.suggestions:
        base.notice = "S/Aの記載から根拠を確認できる薬剤候補はありませんでした。"
    return base


LIVE_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "chief_complaint": {"type": "string"},
        "clinical_reasoning": {"type": "string"},
        "prescription_draft": {"type": "string"},
        "referral_letter": {"type": "string"},
    },
    "required": ["chief_complaint", "clinical_reasoning", "prescription_draft", "referral_letter"],
    "additionalProperties": False,
}


def _style_reference_block(
    physician_profile: PhysicianProfile, style_examples: list[ConsultationSession]
) -> str:
    parts = []
    if physician_profile.style_notes.strip():
        parts.append(f"# 医師プロファイル（文体・重視ポイント）\n{physician_profile.style_notes.strip()}")
    for i, example in enumerate(style_examples, start=1):
        parts.append(
            f"# 過去のカルテ実例{i}（文体参考のみ。内容は今回とは無関係）\n"
            f"S: {example.soap.subjective}\nO: {example.soap.objective}\n"
            f"A: {example.soap.assessment}\nP: {example.soap.plan}"
        )
    if not parts:
        return "（医師プロファイル・過去実例は未登録です。標準的な診療記録の文体で作成してください。）"
    return "\n\n".join(parts)


async def generate_live_draft(
    settings: Settings,
    session: ConsultationSession,
    physician_profile: PhysicianProfile,
    style_examples: list[ConsultationSession],
) -> LiveDraft:
    """会話ストリームから、手動入力なしで4項目のライブドラフトを生成する（アンビエントスクライブ）。"""
    transcript = _transcript_text(session)
    if not transcript.strip():
        return LiveDraft(updated_at=datetime.utcnow(), is_mock=settings.mock_mode)

    if settings.mock_mode:
        mentions_referral = any(k in transcript for k in ("紹介", "専門医", "転院"))
        return LiveDraft(
            chief_complaint="[MOCK] " + transcript.splitlines()[0][:60],
            clinical_reasoning="[MOCK] 医師の発言傾向に沿った治療方針の考察がここに入ります",
            prescription_draft="[MOCK] 処方内容・生活指導のドラフトがここに入ります",
            referral_letter="[MOCK] 紹介状ドラフト（会話中に紹介への言及があったため生成）" if mentions_referral else "",
            updated_at=datetime.utcnow(),
            is_mock=True,
        )

    style_block = _style_reference_block(physician_profile, style_examples)
    user_content = f"{style_block}\n\n# 今回の診察会話（ここまでの全文）\n{transcript}"
    data = await _chat_json(
        settings, LIVE_DRAFT_SYSTEM_PROMPT, user_content, "live_draft", LIVE_DRAFT_SCHEMA, stage="ライブドラフト更新"
    )
    return LiveDraft(**data, updated_at=datetime.utcnow(), is_mock=False)


async def run_full_pipeline(settings: Settings, session: ConsultationSession) -> None:
    """finalize時に呼ばれ、議事録・SOAP・紹介状・処方オーダをまとめて生成し session に反映する。"""
    session.minutes = await generate_minutes(settings, session)
    session.soap = await generate_soap(settings, session)
    session.referral = await generate_referral(settings, session)
    session.prescription = await extract_prescription(settings, session)
