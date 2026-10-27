const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseFile, evaluate, summarize } = require("../field-eval");
const detector = require("../lib/detector");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "field-eval-"));

test("文字起こしワークフローのログ(時刻つき)を、録音ごとの発言に分ける", () => {
  const file = path.join(dir, "job.log");
  fs.writeFileSync(
    file,
    [
      "2026-10-02T08:32:18.2481844Z ##[group]Run import json",
      "2026-10-02T08:33:03.9739702Z ## 18. 000030068.mp3",
      "2026-10-02T08:33:03.9742314Z - URL: https://example.test/a.mp3",
      "2026-10-02T08:33:03.9746708Z - [0:00] もしもし",
      "2026-10-02T08:33:03.9747034Z - [0:03] 警察の者です",
      "2026-10-02T08:33:25.7912348Z ## 28. 000017687.wav",
      "2026-10-02T08:33:25.7914499Z - [0:01] ちょっと待っててくれる?",
    ].join("\n")
  );
  const calls = parseFile(file);
  assert.deepStrictEqual(calls.map((c) => c.name), ["000030068.mp3", "000017687.wav"]);
  assert.deepStrictEqual(calls[0].utterances, ["もしもし", "警察の者です"]);
});

test("通話ログ(JSON)は相手の発言だけを使う", () => {
  const file = path.join(dir, "CA1.json");
  fs.writeFileSync(file, JSON.stringify({ history: [{ role: "shield", text: "ご用件をどうぞ" }, { role: "caller", text: "還付金があります" }] }));
  assert.deepStrictEqual(parseFile(file)[0].utterances, ["還付金があります"]);
});

test("前と後を比べ、判定が下がることはない", () => {
  const before = detector.createDetector(detector.PATTERNS, { normalize: false });
  const after = detector.createDetector(detector.PATTERNS);
  const calls = [
    { name: "a", utterances: ["五十万円、今日中に用意してほしい"] },
    { name: "b", utterances: ["警察の者です", "あなたの口座が犯罪に使われている", "誰にも言わないでください"] },
    { name: "c", utterances: ["明日の会議は10時からです"] },
  ];
  const s = summarize(calls.map((c) => evaluate(c, { before, after })));
  assert.strictEqual(s.raisedByNormalize, 1);
  assert.strictEqual(s.raisedToHighByChain, 1);
  assert.strictEqual(s.levelDown, 0);
  assert.strictEqual(s.after.none, 1);
});
