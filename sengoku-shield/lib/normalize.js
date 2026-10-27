// @ts-check
// 文字のゆれをそろえる(検知ルールを「書き方の違い」ですり抜けさせないため)
//
// 考え方の出どころ(どれもコードは取り込まず、ルールだけを JavaScript で書き直した。追加の依存なし):
// - neologdn(日本語テキスト正規化。Apache-2.0): 全角/半角・長音記号・日本語の間の空白をそろえる
// - jaconv(日本語の文字種変換。MIT): 漢数字 → 算用数字
// - Unicode TR#15(NFKC)/ TR#39(見えない文字の除去): 「０」と「0」、ゼロ幅文字など
//
// 音声認識(Twilio・スマホのブラウザ)は「五十万円」「１２３４」「キャッシュ カード」のように
// 書き方がばらつくので、ルールの正規表現(\d+万 など)がそのままでは当たらないことがある。
// 検知では「元の文」と「そろえた文」の両方で調べる(lib/detector.js)ので、そろえたせいで
// 今まで当たっていたものが外れることはない。

const DIGITS = /** @type {Record<string, number>} */ ({
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
});
const UNITS = /** @type {Record<string, number>} */ ({ 十: 10, 百: 100, 千: 1000 });
const KANJI_NUM_RUN = /[〇零一二三四五六七八九十百千]+/g;
// 1文字の漢数字は、後ろにお金・桁の単位が付くときだけ数字にする(「一人」「一時的」「千葉」「十分」はそのまま)
const MONEY_UNIT_AFTER = /^[万億兆円]/;

// ゼロ幅文字・文字の向きを変える制御文字・ソフトハイフン(見た目に出ないのに、正規表現を外させる)
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const JA = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々";
const SPACE_BETWEEN_JA = new RegExp(`([${JA}])\\s+(?=[${JA}])`, "gu");
// 「1 2 3 4」「1、2、3、4」のように区切って読まれた数字を、ひとつながりにする
const SEPARATED_DIGITS = /(\d)[\s、,・]+(?=\d)/g;
const HYPHEN_AFTER_KATAKANA = /(\p{Script=Katakana})[\u2010-\u2015\u2212\uFF70-]+/gu;

/**
 * 漢数字のかたまり1つを算用数字の文字列にする。
 * 「一二三四」のように位取り(十百千)が無いものは、1文字ずつ数字に置き換える(番号の読み上げ)。
 * @param {string} run 漢数字だけの文字列
 * @returns {string}
 */
function kanjiRunToDigits(run) {
  const chars = [...run];
  if (!chars.some((c) => Object.hasOwn(UNITS, c))) return chars.map((c) => String(DIGITS[c])).join("");
  let total = 0;
  let current = 0;
  for (const c of chars) {
    if (Object.hasOwn(UNITS, c)) {
      total += (current || 1) * UNITS[c];
      current = 0;
    } else {
      current = current * 10 + DIGITS[c];
    }
  }
  return String(total + current);
}

/**
 * 漢数字を算用数字にする(「五十万円」→「50万円」、「一一〇番」→「110番」、「百万」→「100万」)。
 * @param {string} text
 * @returns {string}
 */
function kanjiNumeralsToDigits(text) {
  return text.replace(KANJI_NUM_RUN, (run, offset, whole) => {
    const next = whole.slice(offset + run.length);
    return run.length >= 2 || MONEY_UNIT_AFTER.test(next) ? kanjiRunToDigits(run) : run;
  });
}

/**
 * 検知用に文字のゆれをそろえる。元の文は書き換えない(新しい文字列を返す)。
 * @param {unknown} input
 * @returns {string}
 */
function normalizeText(input) {
  let text = String(input ?? "").normalize("NFKC").replace(INVISIBLE, "");
  text = text.replace(HYPHEN_AFTER_KATAKANA, "$1ー").replace(/ー{2,}/g, "ー").replace(/~{2,}/g, "~");
  text = text.replace(SPACE_BETWEEN_JA, "$1");
  text = kanjiNumeralsToDigits(text);
  text = text.replace(SEPARATED_DIGITS, "$1");
  return text.replace(/\s+/g, " ").trim();
}

module.exports = { normalizeText, kanjiNumeralsToDigits, kanjiRunToDigits };
