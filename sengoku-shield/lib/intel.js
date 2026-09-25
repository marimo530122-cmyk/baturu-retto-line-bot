// 相手の発言から「警察に伝えるべき手がかり」を抜き出す
// (電話番号・口座・金融機関・金額・日時・場所・自宅に来る話・名乗った名前・URL)
//
// - 相手(詐欺の疑いがある側)の発言だけに使う。本人の情報を抜き出す用途には使わない。
// - 音声認識の聞き間違いや、ただの言い回しにも当たるので、結果は「候補」として人が確かめる前提。
// - サーバー(Node)と見守り画面・デモページ(ブラウザ)の両方で同じものを使う。

(function (root) {
  const RULES = [
    { type: "phone", label: "電話番号", source: "(?:\\+81|0)\\d{1,4}[-‐ー−\\s]?\\d{1,4}[-‐ー−\\s]?\\d{3,4}" },
    { type: "account", label: "口座番号", source: "(?:口座(?:番号)?|普通|当座)(?:は|が|番号は)?[:：\\s]*(\\d[\\d\\s-]{4,10}\\d)", group: 1 },
    { type: "bank", label: "金融機関", source: "[^\\s、。「」]{1,10}(?:銀行|信用金庫|信金|信用組合|ゆうちょ|郵便局|農協)(?:[^\\s、。「」]{1,10}支店)?" },
    { type: "amount", label: "金額", source: "\\d{1,3}(?:,\\d{3})+円|\\d+(?:万|千)?円|\\d+万|[一二三四五六七八九十百千]+万円?" },
    {
      type: "datetime",
      label: "日時",
      source:
        "(?:今日|明日|明後日|あさって|本日|今夜|今晩|\\d{1,2}月\\d{1,2}日|\\d{1,2}日)(?:の)?(?:午前|午後|朝|夕方|夜)?\\s*(?:\\d{1,2}時(?:\\d{1,2}分|半)?)?|(?:午前|午後)?\\d{1,2}時(?:\\d{1,2}分|半)?",
    },
    {
      type: "place",
      label: "場所",
      // 場所の名前は助詞(に・で・を・は・が・と)の手前までにする(「明日の3時に」まで拾わないように)
      source:
        "[^\\s、。「」にでをはがと]{1,12}(?:駅|公園|コンビニ|郵便局|スーパー|駐車場|交差点)(?:の?[^\\s、。「」にでをはがと]{0,8}?(?:改札|出口|ロータリー|前))?",
    },
    { type: "visit", label: "自宅に来る話", source: "(?:ご?自宅|家|お宅|おうち)(?:に|まで)(?:伺|行|うかが|取りに|受け取りに|回収)" },
    { type: "person", label: "名乗った名前", source: "(?:担当|係)の?([^\\s、。「」]{1,8}?)(?:と申します|です|が伺|が行)|([^\\s、。「」]{1,8}?)と申します", group: [1, 2] },
    { type: "url", label: "URL", source: "https?:\\/\\/[^\\s「」、。]+|[a-z0-9-]+\\.(?:com|net|jp|org|info|xyz)(?:\\/[^\\s「」、。]*)?", flags: "i" },
  ];

  // 抜き出した手がかりを種類ごとに重複なしで返す
  function extract(lines) {
    const found = [];
    const seen = new Set();
    for (const line of lines || []) {
      const text = String(line || "");
      for (const rule of RULES) {
        const re = new RegExp(rule.source, "g" + (rule.flags || ""));
        let m;
        while ((m = re.exec(text))) {
          if (!m[0]) {
            re.lastIndex++;
            continue;
          }
          const groups = Array.isArray(rule.group) ? rule.group : rule.group ? [rule.group] : [0];
          const value = groups.map((g) => m[g]).find(Boolean);
          if (!value) continue;
          const v = value.trim();
          const key = `${rule.type}:${v}`;
          if (!v || seen.has(key)) continue;
          seen.add(key);
          found.push({ type: rule.type, label: rule.label, value: v, line: text });
        }
      }
    }
    return found;
  }

  // 相手が会う日時・場所や、家に来る話をしてきたか(=すぐ110番を勧める場面)
  function needsPoliceNow(found) {
    const types = new Set(found.map((f) => f.type));
    return types.has("visit") || (types.has("datetime") && types.has("place"));
  }

  const api = { RULES, extract, needsPoliceNow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShieldIntel = api;
})(typeof window !== "undefined" ? window : globalThis);
