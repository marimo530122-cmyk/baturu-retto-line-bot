"""薬剤候補の提案(suggest_drugs)の安全装置。

- S/Aに書かれていない症状・診断を根拠にした提案(=引用が原文に無い)は捨てられること
- 処方オーダには一切書き込まれない(自動入力されない)こと
- 免責文言が必ず付くこと
"""
from fastapi.testclient import TestClient

from app.data import store
from app.main import app
from app.models import DRUG_SUGGESTION_DISCLAIMER, ConsultationSession, PrescriptionItem
from app.services import llm_pipeline

client = TestClient(app)


def _suggestion(drug_name: str, quote: str) -> dict:
    return {
        "drug_name": drug_name,
        "suggestion_text": f"{drug_name}はいかがでしょうか。",
        "rationale": "一般的な理由",
        "grounding_quote": quote,
        "cautions": "アレルギーの有無を確認",
    }


def _session_with_soap() -> ConsultationSession:
    session = ConsultationSession(patient_id="p001")
    session.soap.subjective = "3日前から咳と微熱が続いている。夜間に咳で眠れない。"
    session.soap.assessment = "急性上気道炎"
    return session


def test_is_grounded_accepts_verbatim_quote_and_ignores_whitespace_and_width():
    assert llm_pipeline.is_grounded("咳と微熱が続いている", ["3日前から咳と微熱が続いている。"])
    assert llm_pipeline.is_grounded("３日前から 咳と微熱", ["3日前から咳と微熱が続いている。"])


def test_is_grounded_rejects_fabricated_or_too_short_or_straddling_quotes():
    sources = ["3日前から咳と微熱が続いている。", "急性上気道炎"]
    assert not llm_pipeline.is_grounded("咽頭痛と鼻汁がある", sources)  # 原文に無い症状
    assert not llm_pipeline.is_grounded("咳", sources)  # 短すぎて根拠確認にならない
    assert not llm_pipeline.is_grounded("続いている。急性上気道炎", sources)  # S/Aをまたぐつぎはぎ


async def test_empty_soap_returns_no_suggestions_with_notice(mock_settings):
    session = ConsultationSession(patient_id="p001")
    result = await llm_pipeline.suggest_drugs(mock_settings, session)
    assert result.suggestions == []
    assert "空" in result.notice
    assert result.disclaimer == DRUG_SUGGESTION_DISCLAIMER


async def test_mock_mode_returns_grounded_suggestion(mock_settings):
    session = _session_with_soap()
    result = await llm_pipeline.suggest_drugs(mock_settings, session)
    assert result.is_mock is True
    assert len(result.suggestions) == 1
    assert result.basis_subjective == session.soap.subjective
    assert result.basis_assessment == "急性上気道炎"


async def test_real_mode_discards_ungrounded_and_already_prescribed(monkeypatch):
    from app.config import Settings

    session = _session_with_soap()
    session.prescription.items = [PrescriptionItem(drug_name="アセトアミノフェン錠200mg", dosage="", frequency="", days_supply=5)]

    async def fake_chat_json(*args, **kwargs):
        return {
            "suggestions": [
                _suggestion("デキストロメトルファン", "夜間に咳で眠れない"),  # 根拠あり → 残る
                _suggestion("抗菌薬X", "細菌性肺炎の疑い"),  # 原文に無い診断 → 捨てる
                _suggestion("アセトアミノフェン", "咳と微熱が続いている"),  # 処方済み → 捨てる
            ]
        }

    monkeypatch.setattr(llm_pipeline, "_chat_json", fake_chat_json)
    result = await llm_pipeline.suggest_drugs(Settings(openai_api_key="dummy"), session)

    assert [s.drug_name for s in result.suggestions] == ["デキストロメトルファン"]
    assert result.discarded_count == 2
    assert result.is_mock is False


async def test_suggestions_are_capped(monkeypatch):
    from app.config import Settings

    async def fake_chat_json(*args, **kwargs):
        return {"suggestions": [_suggestion(f"薬{i}", "咳と微熱が続いている") for i in range(5)]}

    monkeypatch.setattr(llm_pipeline, "_chat_json", fake_chat_json)
    result = await llm_pipeline.suggest_drugs(Settings(openai_api_key="dummy"), _session_with_soap())
    assert len(result.suggestions) == llm_pipeline.MAX_DRUG_SUGGESTIONS


def test_endpoint_does_not_modify_prescription():
    session = store.create_session(store.list_patients()[0].id)
    client.patch(f"/api/sessions/{session.id}/soap", json={"subjective": "咳と微熱が続いている", "assessment": "急性上気道炎"})
    before = client.get(f"/api/sessions/{session.id}/prescription").json()

    res = client.post(f"/api/sessions/{session.id}/prescription/drug-suggestions")
    assert res.status_code == 200
    body = res.json()
    assert body["disclaimer"] == DRUG_SUGGESTION_DISCLAIMER
    assert "dosage" not in body["suggestions"][0]  # 用量は提案しない

    after = client.get(f"/api/sessions/{session.id}/prescription").json()
    assert after == before
