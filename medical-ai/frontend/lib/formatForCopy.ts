import type { ComplianceCheckResult, PrescriptionOrder, ReferralLetter, SoapNote } from "./types";

/** 外部の電子カルテ・レセコンへそのまま貼り付けられるよう、プレーンテキストに整形する。 */

export function formatSoapForCopy(soap: SoapNote): string {
  return [
    `S（主観的情報）: ${soap.subjective}`,
    `O（客観的情報）: ${soap.objective}`,
    `A（評価）: ${soap.assessment}`,
    `P（計画）: ${soap.plan}`,
  ].join("\n");
}

export function formatReferralForCopy(referral: ReferralLetter): string {
  return [
    "【診療情報提供書】",
    `紹介先医療機関: ${referral.to_institution}`,
    `診療科: ${referral.to_department}`,
    `紹介理由: ${referral.reason_for_referral}`,
    "",
    "臨床経過の要約:",
    referral.clinical_summary,
    "",
    "現在の治療内容:",
    referral.current_treatment,
    "",
    `依頼事項: ${referral.requested_action}`,
  ].join("\n");
}

export function formatPrescriptionForCopy(prescription: PrescriptionOrder): string {
  const lines = [`診断名: ${prescription.diagnosis}`];
  if (prescription.patient_request_note) {
    lines.push(`患者の要望: ${prescription.patient_request_note}`);
  }
  lines.push("", "【処方内容】");
  prescription.items.forEach((item, i) => {
    const notes = item.notes ? `（${item.notes}）` : "";
    lines.push(
      `${i + 1}. ${item.drug_name}　${item.dosage}　${item.frequency}　${item.days_supply}日分　${item.quantity}${notes}`
    );
  });
  return lines.join("\n");
}

export function formatComplianceForCopy(result: ComplianceCheckResult): string {
  const kindLabel: Record<string, string> = {
    existing_diagnosis_exception: "既存診断の特例該当チェック",
    outside_prescription: "院外処方せんへの切替",
    split_visit: "分割処方（複数回来院）",
    self_pay: "自費（自由診療）処方",
  };
  const lines = ["【処方適正化アドバイザー 提案一覧】", "", result.disclaimer, ""];
  result.suggestions.forEach((s, i) => {
    lines.push(`${i + 1}. [${kindLabel[s.kind] || s.kind}] ${s.title}`);
    lines.push(s.description);
    lines.push(`根拠: ${s.legal_basis}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}
