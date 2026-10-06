"""モックモード(OPENAI_API_KEY未設定)でのSOAP/紹介状/処方抽出。
ネットワーク呼び出しを一切行わずに、データ変換ロジックの骨格が壊れていないかを確認する。
"""
from app.services import llm_pipeline


async def test_generate_soap_mock_mode(mock_settings, session_with_transcript):
    soap = await llm_pipeline.generate_soap(mock_settings, session_with_transcript)
    assert soap.is_mock is True
    assert soap.subjective and soap.objective and soap.assessment and soap.plan
    assert soap.generated_at is not None


async def test_generate_soap_empty_transcript_is_mock(mock_settings):
    from app.models import ConsultationSession

    session = ConsultationSession(patient_id="p001")
    soap = await llm_pipeline.generate_soap(mock_settings, session)
    assert soap.is_mock is True


async def test_generate_referral_mock_mode_uses_soap_assessment(mock_settings, session_with_transcript):
    session_with_transcript.soap.assessment = "急性上気道炎"
    referral = await llm_pipeline.generate_referral(mock_settings, session_with_transcript)
    assert referral.is_mock is True
    assert referral.clinical_summary == "急性上気道炎"


async def test_extract_prescription_mock_mode_has_at_least_one_item(mock_settings, session_with_transcript):
    prescription = await llm_pipeline.extract_prescription(mock_settings, session_with_transcript)
    assert prescription.is_mock is True
    assert len(prescription.items) >= 1
    assert prescription.items[0].days_supply > 0


async def test_generate_live_draft_detects_referral_mentions(mock_settings, session_with_transcript):
    from app.models import PhysicianProfile, Speaker, TranscriptSegment

    session_with_transcript.transcript.append(
        TranscriptSegment(speaker=Speaker.DOCTOR, text="専門医への紹介を検討します", is_final=True)
    )
    draft = await llm_pipeline.generate_live_draft(mock_settings, session_with_transcript, PhysicianProfile(), [])
    assert draft.is_mock is True
    assert draft.referral_letter != ""


async def test_generate_live_draft_no_referral_mentions_leaves_it_empty(mock_settings, session_with_transcript):
    from app.models import PhysicianProfile

    draft = await llm_pipeline.generate_live_draft(mock_settings, session_with_transcript, PhysicianProfile(), [])
    assert draft.referral_letter == ""


async def test_run_full_pipeline_populates_all_documents(mock_settings, session_with_transcript):
    await llm_pipeline.run_full_pipeline(mock_settings, session_with_transcript)
    assert session_with_transcript.minutes != ""
    assert session_with_transcript.soap.is_mock is True
    assert session_with_transcript.referral.is_mock is True
    assert session_with_transcript.prescription.is_mock is True
