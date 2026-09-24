// 詐欺パターン検知(正規表現ベース)
//
// 方針:
// - 「何を言われたか」の文言だけで判定する。声紋照合や「家族を名乗っているか」の
//   判定(オレオレ詐欺検知)は、精度が低く誤判定の実害が大きいので入れない。
// - 結果はあくまで「疑いの強さ」の目安。相手を詐欺師と断定する用途には使わない。

const fs = require("fs");
const path = require("path");

const BUILTIN_PATTERNS = [
  {
    id: "refund",
    label: "還付金・払い戻し",
    weight: 3,
    regex: /還付|払い?戻し|返金(が|を)?(あり|でき|受け)/,
  },
  {
    id: "atm",
    label: "ATM操作の誘導",
    weight: 4,
    regex: /ATM|エーティーエム|現金自動|振込機/i,
  },
  {
    id: "card_pin",
    label: "キャッシュカード・暗証番号",
    weight: 4,
    regex: /暗証番号|キャッシュカード|カードを?(預か|回収|交換|封筒)/,
  },
  {
    id: "gift_card",
    label: "電子マネー・ギフトカード払い",
    weight: 4,
    regex: /電子マネー|ギフト(カード|券)|プリペイド|(アマゾン|Amazon|アップル|Apple|グーグル|Google|iTunes).{0,6}(カード|券)|コンビニで.{0,10}(買|購入)/i,
  },
  {
    id: "unpaid_legal",
    label: "未納料金・訴訟の脅し",
    weight: 3,
    regex: /未納|滞納|未払い|訴訟|裁判|差し?押さえ|法的(措置|手続)|債権/,
  },
  {
    id: "account_frozen",
    label: "口座凍結・不正利用",
    weight: 3,
    regex: /口座.{0,6}(凍結|停止|使えなく)|不正(利用|使用|アクセス)|犯罪に(使|利用)/,
  },
  {
    id: "authority",
    label: "公的機関・警察を名乗る",
    weight: 2,
    regex: /警察|警視庁|刑事|金融庁|財務局|検察|裁判所|市役所|区役所|年金(事務所|機構)|税務署|総務省|消費者(センター|庁)|全国銀行協会/,
  },
  {
    id: "urgency",
    label: "急がせる・今日中",
    weight: 1,
    regex: /至急|今日中|本日中|今すぐ|すぐに|期限が?(今日|本日)|あと\d+(分|時間)/,
  },
  {
    id: "secrecy",
    label: "口止め",
    weight: 2,
    regex: /(誰|だれ)にも(言わ|話さ|相談し)|内緒|秘密に|家族に(は)?(言わ|話さ)/,
  },
  {
    id: "personal_info",
    label: "個人情報・資産の聞き出し",
    weight: 2,
    regex: /口座番号|預金(残高|額)|貯金(は|が)?いくら|(生年月日|マイナンバー)を?(教え|確認)|タンス預金|家に(現金|お金)/,
  },
  {
    id: "investment",
    label: "もうけ話・投資",
    weight: 2,
    regex: /必ず(儲か|もうか)|元本保証|高配当|未公開株|名義(を)?貸|当選(しました|金)/,
  },
];

// evolve.js で人間が承認した追加パターン(patterns.custom.json)を読み込む
const CUSTOM_PATTERNS_PATH =
  process.env.SHIELD_CUSTOM_PATTERNS || path.join(__dirname, "..", "patterns.custom.json");

function loadCustomPatterns() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CUSTOM_PATTERNS_PATH, "utf-8"));
  } catch {
    return [];
  }
  return raw.map((p) => ({ ...p, regex: new RegExp(p.source, p.flags || "") }));
}

const PATTERNS = [...BUILTIN_PATTERNS, ...loadCustomPatterns()];

const LEVELS = [
  { min: 8, level: "high", label: "詐欺の疑い:高" },
  { min: 4, level: "medium", label: "詐欺の疑い:中" },
  { min: 1, level: "low", label: "詐欺の疑い:低" },
  { min: 0, level: "none", label: "該当なし" },
];

// テキストに含まれる詐欺パターンを返す(同じパターンは1回だけ数える)
function detect(text) {
  const matches = [];
  for (const p of PATTERNS) {
    const m = String(text || "").match(p.regex);
    if (m) matches.push({ id: p.id, label: p.label, weight: p.weight, hit: m[0] });
  }
  return matches;
}

// 通話全体(相手の発話すべて)からスコアとレベルを出す
function score(utterances) {
  const seen = new Map();
  for (const u of utterances) {
    for (const m of detect(u)) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }
  }
  const matches = [...seen.values()];
  const total = matches.reduce((sum, m) => sum + m.weight, 0);
  const { level, label } = LEVELS.find((l) => total >= l.min);
  return { score: total, level, label, matches };
}

module.exports = { PATTERNS, BUILTIN_PATTERNS, CUSTOM_PATTERNS_PATH, detect, score };
