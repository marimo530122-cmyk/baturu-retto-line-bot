// 電話番号は下4桁以外を伏せる(ログ表示・通知・SNS下書き用)
function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "非通知";
  return `***-****-${digits.slice(-4)}`;
}

// 文章中の電話番号・長い数字列を伏せる(SNS下書き用)
function maskText(text) {
  return String(text || "")
    .replace(/\+?\d[\d\-\s()]{8,}\d/g, "[番号伏せ字]")
    .replace(/\d{4,}/g, "[数字伏せ字]");
}

module.exports = { maskPhone, maskText };
