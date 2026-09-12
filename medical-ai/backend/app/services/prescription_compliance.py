"""処方適正化アドバイザー（合法的な代替案エンジン）。

このモジュールは、当初仕様にあった「病名を示唆して保険の特例を通す」ような裏技提案を
**行わない**。代わりに、以下の合法的な選択肢のみを機械的に提示する。

1. 既存診断の特例該当チェック
   - AIが新しい診断名を提案・創作することは一切しない。
   - 医師がカルテに実際に記録した診断名 (session.prescription.diagnosis) が、
     長期処方等の正規の特例要件（サンプルの `EXCEPTION_DIAGNOSES` に一致）と
     たまたま一致する場合にのみ、「特例要件に該当する可能性があるので確認してください」
     という事実ベースの情報を提示する。診断名の変更は促さない。
2. 院外処方せんへの切替
3. 分割処方（複数回来院）
4. 自費（自由診療）処方

ルール（日数上限・特例診断名リスト）はデモ用のサンプルであり、本番では院内・保険者の
正式なマスタデータに置き換えること。
"""
from __future__ import annotations

from app.models import (
    COMPLIANCE_DISCLAIMER,
    ComplianceCheckResult,
    ComplianceSuggestion,
    ComplianceSuggestionKind,
    PrescriptionOrder,
)

# サンプル: 標準的な投薬日数上限（デモ用）。本番は院内マスタ・診療報酬点数表に準拠させる。
DEFAULT_MAX_DAYS_SUPPLY = 30

# サンプル: 一部の新薬・向精神薬等は投薬日数に上限がある（デモ用の簡易版）。
RESTRICTED_DRUG_KEYWORDS: dict[str, int] = {
    "睡眠導入剤": 30,
    "向精神薬": 30,
    "新薬": 14,
}

# サンプル: 長期処方の正規の特例要件に該当し得る「慢性疾患」の診断名リスト（デモ用）。
# 実運用では厚生局・保険者が定める正式な特例要件マスタに差し替えること。
EXCEPTION_DIAGNOSES = {
    "高血圧症",
    "糖尿病",
    "脂質異常症",
    "慢性心不全",
    "甲状腺機能低下症",
}


def _max_days_for_drug(drug_name: str) -> int:
    for keyword, limit in RESTRICTED_DRUG_KEYWORDS.items():
        if keyword in drug_name:
            return limit
    return DEFAULT_MAX_DAYS_SUPPLY


def check_prescription(order: PrescriptionOrder, requested_days_supply: int | None = None) -> ComplianceCheckResult:
    over_limit_items = []
    for item in order.items:
        requested = requested_days_supply or item.days_supply
        limit = _max_days_for_drug(item.drug_name)
        if requested > limit:
            over_limit_items.append((item.drug_name, requested, limit))

    if not over_limit_items:
        return ComplianceCheckResult(triggered=False, suggestions=[])

    suggestions: list[ComplianceSuggestion] = []

    diagnosis = (order.diagnosis or "").strip()
    if diagnosis and diagnosis in EXCEPTION_DIAGNOSES:
        suggestions.append(
            ComplianceSuggestion(
                kind=ComplianceSuggestionKind.EXISTING_DIAGNOSIS_EXCEPTION,
                title="記録済みの診断名が長期処方特例の対象要件に該当する可能性があります",
                description=(
                    f"カルテに記録されている診断名「{diagnosis}」は、慢性疾患に対する"
                    "長期処方の特例要件に該当し得ます。実際の病状としてこの診断が正しい場合に限り、"
                    "院内規定に基づき投薬日数の延長を検討できます。"
                    "※診断名を保険適用のためだけに変更・追加することは不正請求に当たるため行わないでください。"
                ),
                legal_basis="院内処方ルール（長期処方の特例要件） ※サンプル、正式マスタに要差替え",
            )
        )
    else:
        suggestions.append(
            ComplianceSuggestion(
                kind=ComplianceSuggestionKind.EXISTING_DIAGNOSIS_EXCEPTION,
                title="現在の記録診断名では特例要件に該当しません",
                description=(
                    "現在カルテに記録されている診断名では、長期処方の特例要件には該当しません。"
                    "特例を適用する場合は、実際の病状に基づく正確な診断名がその要件を満たしている場合に限られます。"
                    "病状に基づかない診断名の変更は行わないでください。"
                ),
                legal_basis="院内処方ルール（長期処方の特例要件） ※サンプル、正式マスタに要差替え",
                requires_physician_confirmation=True,
            )
        )

    suggestions.append(
        ComplianceSuggestion(
            kind=ComplianceSuggestionKind.OUTSIDE_PRESCRIPTION,
            title="院外処方せんへの切替",
            description="院外処方せんとして発行し、調剤薬局側の在庫・分割調剤の仕組みを活用する方法です。",
            legal_basis="保険調剤ルール（分割調剤の活用等）",
        )
    )
    suggestions.append(
        ComplianceSuggestion(
            kind=ComplianceSuggestionKind.SPLIT_VISIT,
            title="分割処方（複数回来院）",
            description="1回あたりの処方日数を上限内に収め、患者に複数回来院してもらうことで希望数量に対応します。",
            legal_basis="通常の保険診療ルールの範囲内",
        )
    )
    suggestions.append(
        ComplianceSuggestion(
            kind=ComplianceSuggestionKind.SELF_PAY,
            title="自費（自由診療）処方の案内",
            description=(
                "希望数量が保険診療の適用範囲を超える場合、患者への説明・同意のうえで"
                "自費処方という選択肢を案内できます。"
            ),
            legal_basis="自由診療の枠組み（患者への十分な説明と同意が必要）",
        )
    )

    return ComplianceCheckResult(triggered=True, disclaimer=COMPLIANCE_DISCLAIMER, suggestions=suggestions)
