// 音声認識が1つの文を2つの発言に分けてしまう問題への対策(lib/detector.js の joinLines)のテスト
const test = require("node:test");
const assert = require("node:assert");
const detector = require("../lib/detector");
const { judgeUtterance } = require("../lib/realtime");
const benign = require("../benign-samples.json");

const { score, continuesToNext, rejoinSplitSentence } = detector;
const noJoin = detector.createDetector(detector.PATTERNS, { joinLines: false });
const FLAGGED = new Set(["medium", "high"]);

test("警察が公開した実際の録音の文字起こし(2行に分かれた文)をつなげて拾う", () => {
  const lines = ["名前とか青年月日とか聞かれると思うんだけど", "それを答えちゃってもらって大丈夫だからさ"];
  assert.deepStrictEqual(noJoin.score(lines).matches, []);
  const m = score(lines).matches.find((x) => x.id === "answer_for_me");
  assert.ok(m, "つなげた文で「聞かれたら答えて大丈夫」を拾う");
  assert.strictEqual(m.joined, true);
});

test("言い切っていない発言だけを次につなげる", () => {
  for (const t of ["聞かれると思うんだけど", "暗証番号を確認したいので", "カードを封筒に入れて", "銀行の窓口で、"]) {
    assert.strictEqual(continuesToNext(t), true, t);
  }
  for (const t of ["お荷物をお届けしました。", "大丈夫ですか?", "はい", "もしもし"]) {
    assert.strictEqual(continuesToNext(t), false, t);
  }
});

test("つなげるのは区切られた1つの文だけ(前の発言の最後の文 + 次の発言の最初の文)", () => {
  assert.strictEqual(
    rejoinSplitSentence("お世話になります。銀行の窓口で理由を聞かれたら", "旅行に使うって答えてください。それでは。"),
    "銀行の窓口で理由を聞かれたら旅行に使うって答えてください。"
  );
});

test("「。」で終わった発言の次とはつなげない", () => {
  const lines = ["名前とか生年月日を聞かれると思います。", "それを答えちゃってもらって大丈夫だからさ"];
  assert.ok(!score(lines).matches.some((m) => m.joined));
});

test("「同じ発言の中にAとBがそろったとき」のルールは、つなげた文では調べない", () => {
  // 警察の名乗りとビデオ通話が、別々の話の切れ目でたまたま並んだだけのもの
  const lines = ["警察署の生活安全課で", "おばあちゃん、日曜日にビデオ通話しようね。"];
  assert.ok(!score(lines).matches.some((m) => m.id === "police_video_call"));
});

// 普通の電話の例文を、言い切っていない所でわざと切って、ほかの例文の頭につなげる(約3万通り)。
// 実際の電話よりずっと意地悪な組み合わせ。つなげたせいで「中」以上になったものを数える。
test("普通の電話の例文を切ってつなげても、つなげたせいの誤検知はほぼ出ない(約3万通り中2件まで)", () => {
  const fragments = [];
  for (const x of benign) {
    for (let i = 2; i < x.text.length - 1; i++) {
      const head = x.text.slice(0, i);
      if (continuesToNext(head)) fragments.push({ head, rest: x.text.slice(i) });
    }
  }
  let pairs = 0;
  const raised = [];
  for (const f of fragments) {
    for (const next of [f.rest, ...benign.map((b) => b.text)]) {
      pairs++;
      const lines = [f.head, next];
      if (FLAGGED.has(score(lines).level) && !FLAGGED.has(noJoin.score(lines).level)) {
        raised.push(rejoinSplitSentence(f.head, next));
      }
    }
  }
  assert.ok(pairs > 20_000, `組み合わせが少なすぎる: ${pairs}`);
  // 今あるのは「契約書に割印をして」+「カード会社です。」(割印とカードが並ぶ)だけ。実際の電話でこう並ぶことはまれなので許す
  assert.ok(raised.length <= 2, `つなげたせいの誤検知 ${raised.length}件:\n${raised.slice(0, 10).join("\n")}`);
});

test("見守り画面の判定(直近の発言+今の発言)でも、区切られた文をつなげて判定する", async () => {
  const r = await judgeUtterance(
    { utterance: "それを答えちゃってもらって大丈夫だからさ", recent: ["名前とか生年月日とか聞かれると思うんだけど"] },
    { useJev: false }
  );
  assert.ok(r.matched_ids.includes("answer_for_me"));
});
