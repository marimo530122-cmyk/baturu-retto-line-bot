from app.models import ComplianceSuggestionKind, PrescriptionItem, PrescriptionOrder
from app.services.prescription_compliance import check_prescription


def _order(diagnosis: str, drug_name: str, days_supply: int) -> PrescriptionOrder:
    return PrescriptionOrder(
        diagnosis=diagnosis,
        items=[PrescriptionItem(drug_name=drug_name, dosage="1回1錠", frequency="1日1回", days_supply=days_supply)],
    )


def test_under_limit_is_not_triggered():
    order = _order("風邪症候群", "風邪薬", days_supply=14)
    result = check_prescription(order)
    assert result.triggered is False
    assert result.suggestions == []


def test_over_limit_without_exception_diagnosis_requires_confirmation():
    order = _order("風邪症候群", "一般薬", days_supply=60)
    result = check_prescription(order)
    assert result.triggered is True
    exception_suggestion = next(
        s for s in result.suggestions if s.kind == ComplianceSuggestionKind.EXISTING_DIAGNOSIS_EXCEPTION
    )
    assert exception_suggestion.requires_physician_confirmation is True
    # AIが診断名を書き換えるよう促す文言になっていないことを確認する(安全上の要件)
    assert "変更" not in exception_suggestion.title


def test_over_limit_with_exception_diagnosis_surfaces_existing_record():
    order = _order("糖尿病", "一般薬", days_supply=60)
    result = check_prescription(order)
    assert result.triggered is True
    exception_suggestion = next(
        s for s in result.suggestions if s.kind == ComplianceSuggestionKind.EXISTING_DIAGNOSIS_EXCEPTION
    )
    assert "糖尿病" in exception_suggestion.description
    # 特例要件に一致する診断名であっても、最終判断は必ず医師の確認を要する(安全要件)
    assert exception_suggestion.requires_physician_confirmation is True


def test_restricted_drug_keyword_has_lower_limit():
    # 通常の上限(30日)以内だが、新薬は14日が上限なのでトリガーされる
    order = _order("風邪症候群", "新薬A", days_supply=20)
    result = check_prescription(order)
    assert result.triggered is True


def test_requested_days_supply_overrides_item_days_supply():
    order = _order("風邪症候群", "一般薬", days_supply=10)
    # 処方箋自体は10日分だが、患者からの希望日数が上限を超えている場合も検知する
    result = check_prescription(order, requested_days_supply=45)
    assert result.triggered is True


def test_all_suggestions_include_legal_alternatives():
    order = _order("風邪症候群", "一般薬", days_supply=60)
    result = check_prescription(order)
    kinds = {s.kind for s in result.suggestions}
    assert ComplianceSuggestionKind.OUTSIDE_PRESCRIPTION in kinds
    assert ComplianceSuggestionKind.SPLIT_VISIT in kinds
    assert ComplianceSuggestionKind.SELF_PAY in kinds
