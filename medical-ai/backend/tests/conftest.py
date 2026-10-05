import pytest

from app.config import Settings
from app.models import ConsultationSession, Speaker, TranscriptSegment


@pytest.fixture
def mock_settings() -> Settings:
    """OPENAI_API_KEY未設定=モックモードの設定(ネットワーク呼び出し無しでテストする)。"""
    return Settings(openai_api_key=None)


@pytest.fixture
def session_with_transcript() -> ConsultationSession:
    session = ConsultationSession(patient_id="p001")
    session.transcript = [
        TranscriptSegment(speaker=Speaker.PATIENT, text="3日前から咳と微熱が続いています", is_final=True),
        TranscriptSegment(speaker=Speaker.DOCTOR, text="風邪ですね。お薬を出しておきます", is_final=True),
    ]
    return session
