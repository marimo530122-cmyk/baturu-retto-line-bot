// 通院カルテの「症状の整理」「病名の候補」「薬の解説」のテスト。
// ※実際の診察記録は個人情報なので使わない。ここの文はすべて作り話。
// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeKarte,
  collapseGrowingUtterances,
  karteInsightsMarkdown,
} from "../lib/karteInsights.ts";

let clock = Date.UTC(2026, 0, 1, 1, 0, 0);
function u(text: string, gapMs = 10_000) {
  clock += gapMs;
  return { id: String(clock), text, category: "other" as const, summary: text.slice(0, 20), importance: 1 as const, timestamp: clock };
}

test("同じ発言が伸びながら何度も確定した分は、一番長いもの1つにまとめる", () => {
  const list = [u("頭が"), u("頭が痛くて", 1000), u("頭が痛くて眠れない", 1000), u("別の話です")];
  const collapsed = collapseGrowingUtterances(list);
  assert.deepEqual(collapsed.map((x) => x.text), ["頭が痛くて眠れない", "別の話です"]);
});

test("離れた時間の同じ言葉は、別の発言として残す", () => {
  const list = [u("はい"), u("はい", 120_000)];
  assert.equal(collapseGrowingUtterances(list).length, 2);
});

test("心の症状の言葉を拾い、根拠の発言と一緒に整理する", () => {
  const insights = analyzeKarte([
    u("夜になると昔のことのフラッシュバックがあります"),
    u("事故のあった道は今も避けてしまいます"),
    u("寝つきが悪くて朝まで眠れない日もあります"),
  ]);
  const labels = insights.symptoms.map((f) => f.pattern.id);
  assert.ok(labels.includes("flashback"));
  assert.ok(labels.includes("avoidance"));
  assert.ok(labels.includes("sleep"));
  assert.match(insights.symptoms.find((f) => f.pattern.id === "sleep")!.evidence[0].text, /寝つき/);
});

test("PTSDの候補は、中心になる症状(フラッシュバック等)があるときだけ出す", () => {
  const withCore = analyzeKarte([u("フラッシュバックがあります"), u("眠れない日が続きます")]);
  assert.ok(withCore.candidates.some((c) => c.candidate.id === "ptsd"));

  // 眠れない+不安だけでは、PTSDの候補にしない
  const withoutCore = analyzeKarte([u("眠れない日が続きます"), u("将来が不安です")]);
  assert.ok(!withoutCore.candidates.some((c) => c.candidate.id === "ptsd"));
});

test("転換症状の候補は、歩けない等の体の症状が無ければ出さない", () => {
  const none = analyzeKarte([u("不安が強いです"), u("気分が落ち込みます")]);
  assert.ok(!none.candidates.some((c) => c.candidate.id === "conversion"));
  const some = analyzeKarte([u("急に歩けなくなりました"), u("不安が強いです")]);
  assert.ok(some.candidates.some((c) => c.candidate.id === "conversion"));
});

test("病名そのものが会話に出たら候補にし、その言葉を根拠として示す", () => {
  const insights = analyzeKarte([u("以前、線維筋痛症と言われました")]);
  const found = insights.candidates.find((c) => c.candidate.id === "fibromyalgia");
  assert.ok(found);
  const md = karteInsightsMarkdown(insights).join("\n");
  assert.match(md, /【線維筋痛症】根拠:会話に「線維筋痛症」という言葉/);
});

test("候補には必ず「診断ではありません」の注意書きを付ける", () => {
  const md = karteInsightsMarkdown(analyzeKarte([u("フラッシュバックがあります"), u("人をよけて歩きます")])).join("\n");
  assert.match(md, /関係しそうな病気の候補\(診断ではありません\)/);
  assert.match(md, /病名を決めるのは先生です/);
});

test("死にたい・薬をまとめて飲んだ等の発言は、一番上の「先生と共有」に出し、薬の管理の質問を足す", () => {
  const insights = analyzeKarte([u("死にたいと思うことがあります"), u("前に薬を大量に飲んでしまって")]);
  assert.deepEqual(insights.important.map((f) => f.pattern.id), ["suicidal", "overdose"]);
  assert.ok(insights.questions[0].includes("家族が預かって"));
  const md = karteInsightsMarkdown(insights).join("\n");
  assert.ok(md.indexOf("先生と必ず共有しておきたいこと") < md.indexOf("症状と経過の整理"));
});

test("薬の名前が出たら、どんな薬かを一般的に説明する(商品名でも一般名でも)", () => {
  const insights = analyzeKarte([u("パキシルを1日1回出しておきます"), u("リリカは続けてください")]);
  const labels = insights.drugs.map((d) => d.drug.label);
  assert.ok(labels.some((l) => l.includes("パロキセチン")));
  assert.ok(labels.some((l) => l.includes("プレガバリン")));
});

test("スイッチで切ったときは、病名候補を一切出さない", () => {
  const insights = analyzeKarte([u("フラッシュバックがあります"), u("事故の道は避けます")], { includeCandidates: false });
  assert.equal(insights.candidates.length, 0);
  const md = karteInsightsMarkdown(insights).join("\n");
  assert.doesNotMatch(md, /病気の候補/);
  assert.match(md, /症状と経過の整理/);
});

test("症状の言葉が無い会話では、無理に候補を作らない", () => {
  const insights = analyzeKarte([u("今日は晴れていますね"), u("駐車場は混んでいました")]);
  assert.equal(insights.symptoms.length, 0);
  assert.equal(insights.candidates.length, 0);
});
