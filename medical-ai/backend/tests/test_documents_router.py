"""SOAP/紹介状/処方オーダのPATCHエンドポイント。

以前 body.model_dump() を使っていたために、処方オーダのitems(list[PrescriptionItem])が
素のdictへ変換されてしまい、後続の処方適正化チェックで
`AttributeError: 'dict' object has no attribute 'days_supply'` が発生する不具合があった。
model_fields_set + getattr方式に直してから発生していないことを、ここで固定化しておく。
"""
from fastapi.testclient import TestClient

from app.data import store
from app.main import app

client = TestClient(app)


def _create_session() -> str:
    patient_id = store.list_patients()[0].id
    session = store.create_session(patient_id)
    return session.id


def test_update_prescription_keeps_items_as_typed_objects_and_compliance_check_works():
    session_id = _create_session()

    patch_body = {
        "diagnosis": "糖尿病",
        "items": [
            {"drug_name": "テスト薬", "dosage": "1回1錠", "frequency": "1日1回", "days_supply": 60, "quantity": "60錠"}
        ],
    }
    res = client.patch(f"/api/sessions/{session_id}/prescription", json=patch_body)
    assert res.status_code == 200
    assert res.json()["diagnosis"] == "糖尿病"
    assert res.json()["edited"] is True

    # ここが修正前は 'dict' object has no attribute 'days_supply' で500になっていた
    compliance_res = client.post(f"/api/sessions/{session_id}/prescription/compliance-check", json={})
    assert compliance_res.status_code == 200
    assert compliance_res.json()["triggered"] is True


def test_update_soap_only_patches_provided_fields():
    session_id = _create_session()

    res1 = client.patch(f"/api/sessions/{session_id}/soap", json={"subjective": "咳が続く"})
    assert res1.status_code == 200
    assert res1.json()["subjective"] == "咳が続く"
    assert res1.json()["objective"] == ""

    res2 = client.patch(f"/api/sessions/{session_id}/soap", json={"objective": "体温37.8度"})
    assert res2.status_code == 200
    # 前回patchしたsubjectiveが、今回のpatchで上書き・消去されていないこと
    assert res2.json()["subjective"] == "咳が続く"
    assert res2.json()["objective"] == "体温37.8度"


def test_update_referral_only_patches_provided_fields():
    session_id = _create_session()

    res = client.patch(f"/api/sessions/{session_id}/referral", json={"to_institution": "〇〇病院"})
    assert res.status_code == 200
    assert res.json()["to_institution"] == "〇〇病院"
    assert res.json()["edited"] is True


def test_get_unknown_session_returns_404():
    res = client.get("/api/sessions/does-not-exist")
    assert res.status_code == 404
