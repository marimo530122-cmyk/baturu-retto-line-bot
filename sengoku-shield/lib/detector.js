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
    regex: /還付|払い?戻し|返金/,
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
    regex: /口座.{0,6}(凍結|停止|止め|使えなく)|不正(利用|使用|アクセス)|犯罪に(使|利用)/,
  },
  {
    id: "authority",
    label: "公的機関・警察を名乗る",
    weight: 2,
    regex: /警察|警視庁|刑事|金融庁|財務局|検察|裁判所|市役所|区役所|年金(事務所|機構)|税務署|総務省|消費者(センター|庁)|銀行協会/,
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
    regex: /(誰|だれ)にも(言わ|話さ|相談し)|内緒|秘密に|守秘義務[^。]{0,30}(言わ|話さ|口外)|にも(言わ|話さ|相談し)ないで|口外(しない|しちゃ|せず|は)|(家族|銀行|警察|窓口)[^。、]{0,8}(言わ|話さ|相談し)ないで/,
  },
  {
    // 窓口で止められないよう、うその理由を言わせる(金融機関が最後の砦になっているのを逆手に取る手口)
    id: "bank_cover_story",
    label: "窓口での口裏合わせ",
    weight: 4,
    regex: /(銀行|窓口|行員|郵便局|コンビニ)[^。]{0,15}(聞かれ|理由を)[^。]{0,20}(と|って)(答え|言っ|説明し)/,
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
    weight: 3,
    regex: /必ず(儲か|もうか)|元本保証|高配当|未公開株|名義(を)?貸|当選(しました|金)/,
  },
  {
    id: "cash_demand",
    label: "現金・示談金の要求",
    weight: 3,
    regex: /示談金|(お金|現金)が?.{0,4}(必要|要る|いる)|(お金|現金)を?.{0,4}用意|\d+万円?.{0,6}(用意|必要|振り?込)/,
  },
  {
    id: "advance_fee",
    label: "保証金・手数料の先払い",
    weight: 4,
    regex: /(保証金|手数料).{0,12}(先に|事前に|前もって)|(先に|事前に|前もって).{0,12}(保証金|手数料)|保証金.{0,10}(振り?込|払)/,
  },
  {
    // オレオレ詐欺の受け子: 本人の代わりに上司・同僚・代理の者が、お金を受け取りに来る
    // (同じ発言の中に、お金・カードの話と「代わりの人が取りに行く」がそろったときだけ)
    id: "proxy_pickup",
    label: "代わりの人がお金を受け取りに来る",
    weight: 4,
    regex: /^(?=.*(お金|現金|キャッシュカード|カード|通帳))(?=.*(代わりに|かわりに|代理|上司|同僚|部下|後輩|会社の(人|者))[^。]{0,20}(取りに|受け取りに|もらいに|預かりに)(行|伺|来|うかが))/,
  },
  {
    // 警察を名乗ってビデオ通話・LINEに誘う(志太榛原地区4署の呼びかけ「警察がビデオ通話をすることは絶対にありません」)。
    // 家族の「ビデオ通話しよう」には反応しないよう、同じ発言に警察・捜査の名乗りがあるときだけ。
    // 本物の警察の防犯の呼びかけ(「〜することはありません」)にも反応しない。
    id: "police_video_call",
    label: "警察を名乗ってビデオ通話・LINEに誘う",
    weight: 4,
    regex: /^(?!.*(ことは|ことなど)(絶対に|決して)?(ありません|ない))(?=.*(警察|刑事|捜査|検察|警視庁))(?=.*(ビデオ通話|テレビ電話|LINE|ライン|スカイプ|ズーム|Zoom))/,
  },
  {
    // 日本郵便・NTTなどをかたる自動音声で番号を押させる(本物の日本郵便は、自動音声で電話をかけて番号を押させない)。
    // 病院の予約確認など、普通の自動音声には反応しないよう、郵便・荷物・電話停止の話と「番号を押す」がそろったときだけ。
    id: "auto_voice_push",
    label: "郵便・電話会社をかたる自動音声で番号を押させる",
    weight: 4,
    regex: /^(?=.*(日本郵便|郵便局|お荷物|NTT|総務省|電話(が|は)?(使えなく|停止|止ま)))(?=.*([0-9０-９一二三]|いち|に)\s*(番)?\s*を?\s*押し)/,
  },
  {
    // 「資産を守るため、安全な口座へ一時的に移す(避難させる)」。警察・銀行がこう言うことはない
    id: "safe_account",
    label: "安全な口座へお金を移させる",
    weight: 4,
    regex: /安全な口座|(預金|お金|資産|財産)を?[^。]{0,10}(避難|退避)|資産(調査|の保全)|口座(に|へ)[^。]{0,8}(一時的に)?(移し|移動|移す)/,
  },
  {
    // 「あなたにも共犯の疑いがある」「逮捕される」と脅す(ニセ警察官)
    id: "accomplice",
    label: "共犯・逮捕と脅す",
    weight: 3,
    regex: /共犯|容疑がかかって|(あなた|お客様)[^。]{0,10}(逮捕|捜査の対象)|逮捕状|捜査妨害/,
  },
  {
    // 荷物が税関で止められた・偽造品が入っていた(日本郵便・宅配をかたる)
    id: "parcel_trouble",
    label: "荷物のトラブルで不安をあおる",
    weight: 3,
    regex: /(荷物|郵便物|小包)[^。]{0,25}(税関|偽造|不審物|止められ|犯罪に)/,
  },
  {
    // 電話でATMの画面を操作させる(還付金詐欺の決め手。受け取りのはずが振込をさせる)
    id: "atm_operation",
    label: "電話でATMの画面を操作させる",
    weight: 4,
    regex: /(画面|ボタン)[^。]{0,10}(振込|振り込み|お振込)|振込ボタン|金額(欄|のところ)に[^。]{0,12}(打|入力|押)|(受取|受け取り|照会|確認|登録)(コード|番号)[^。]{0,12}(入力|打ち込|押)/,
  },
  {
    // 「電話を切らずに」「携帯を耳に当てたまま」: 相談させないためにつなぎっぱなしにさせる。
    // 病院などの「切らずにお待ちください」もあるので、これだけでは警告しない(重み2)
    id: "keep_on_line",
    label: "電話を切らせない",
    weight: 2,
    regex: /電話を切らず|切らないで(ください|お待ち)|(受話器|携帯|電話)を[^。]{0,4}(耳に当てたまま|持ったまま|つないだまま)|通話(したまま|を続けたまま)/,
  },
  {
    // キャッシュカードのすり替え: 封筒にカードを入れさせ、割印の印鑑を取りに行かせた隙にすり替える
    id: "card_swap",
    label: "カードを封筒に入れさせる(すり替え)",
    weight: 4,
    regex: /(封筒|カード)[^。]{0,15}割印|割印[^。]{0,15}(封筒|カード)|(キャッシュ)?カードを?[^。]{0,6}封筒に(入れ|しまっ)/,
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
  return compileRules(raw);
}

const PATTERNS = [...BUILTIN_PATTERNS, ...loadCustomPatterns()];

const LEVELS = [
  { min: 8, level: "high", label: "詐欺の疑い:高" },
  { min: 4, level: "medium", label: "詐欺の疑い:中" },
  { min: 1, level: "low", label: "詐欺の疑い:低" },
  { min: 0, level: "none", label: "該当なし" },
];

// 任意のルール一式から検知器を作る(ベンチマークで「このルールを足したらどうなるか」を試すのに使う)
function createDetector(patterns) {
  // テキストに含まれる詐欺パターンを返す(同じパターンは1回だけ数える)
  function detect(text) {
    const matches = [];
    for (const p of patterns) {
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

  return { PATTERNS: patterns, detect, score };
}

// 承認済みルール(patterns.custom.json 形式)を検知器用の形に変換する
function compileRules(rules) {
  return rules.map((p) => ({ ...p, regex: new RegExp(p.source, p.flags || "") }));
}

const { detect, score } = createDetector(PATTERNS);

module.exports = {
  PATTERNS,
  BUILTIN_PATTERNS,
  CUSTOM_PATTERNS_PATH,
  detect,
  score,
  createDetector,
  compileRules,
};
