"""app/medical_rules.py を編集するだけで処方適正化チェックの挙動が変わることの回帰テスト。"""
import importlib

from app.models import PrescriptionItem, PrescriptionOrder


def test_adding_exception_diagnosis_changes_compliance_result():
    import app.medical_rules as medical_rules
    import app.services.prescription_compliance as compliance

    original = medical_rules.EXCEPTION_DIAGNOSES
    medical_rules.EXCEPTION_DIAGNOSES = {"新しい追加病名"}
    try:
        importlib.reload(compliance)
        order = PrescriptionOrder(
            diagnosis="新しい追加病名",
            items=[PrescriptionItem(drug_name="薬A", dosage="1錠", frequency="1日1回", days_supply=60)],
        )
        result = compliance.check_prescription(order)
        exception_suggestion = next(
            s for s in result.suggestions if s.kind.value == "existing_diagnosis_exception"
        )
        assert "新しい追加病名" in exception_suggestion.description
    finally:
        # 元の値に戻してから再読み込みする(順序が重要。先に戻さないと汚染した内容が
        # 他のテストに残ってしまう)
        medical_rules.EXCEPTION_DIAGNOSES = original
        importlib.reload(compliance)
