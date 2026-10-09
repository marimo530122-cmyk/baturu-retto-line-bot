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

// --- 5項目まとめ(先生のフィードバック: 概要・今どういう病気か・治療方針・経過観察・今後の方針) ---

test("5項目まとめを、決まった順番で必ず作る", () => {
  const insights = analyzeKarte([u("今日はよろしくお願いします")]);
  assert.deepEqual(insights.summary.map((s) => s.id), ["overview", "condition", "treatment", "progress", "plan"]);
});

test("診察の発言を5項目に振り分ける", () => {
  const insights = analyzeKarte([
    u("最近、夜にフラッシュバックがあって眠れないんです"),
    u("お話を聞く限り、PTSDの可能性が高いと考えられます"),
    u("まずはパキシルを少量から処方して、カウンセリングも始めましょう"),
    u("前回より眠れるようになってきたので、しばらく様子を見ましょう"),
    u("次回は2週間後に予約を取ってください"),
  ]);
  const byId = Object.fromEntries(insights.summary.map((s) => [s.id, s]));
  assert.match(byId.overview.lead.join(), /話題になった症状:.*フラッシュバック/);
  assert.match(byId.condition.evidence[0].text, /PTSDの可能性/);
  assert.ok(byId.treatment.evidence.some((e) => e.text.includes("パキシル")));
  assert.ok(byId.treatment.lead.some((l) => l.includes("パロキセチン")));
  assert.ok(byId.progress.evidence.some((e) => e.text.includes("前回より")));
  assert.ok(byId.plan.evidence.some((e) => e.text.includes("次回は2週間後")));
});

test("話に出なかった項目は「見つかりませんでした」と正直に書き、作り話で埋めない", () => {
  const insights = analyzeKarte([u("今日は寒いですね、駐車場も混んでいました")]);
  const byId = Object.fromEntries(insights.summary.map((s) => [s.id, s]));
  for (const id of ["condition", "treatment", "progress", "plan"]) {
    assert.equal(byId[id].evidence.length, 0);
    assert.match(byId[id].lead.join(), /見つかりませんでした/);
  }
});

test("薬を大量に飲んだ話は、治療方針ではなく「先生と共有」の方に出す", () => {
  const insights = analyzeKarte([u("前に薬を大量に飲んでしまったことがあります")]);
  const treatment = insights.summary.find((s) => s.id === "treatment")!;
  assert.equal(treatment.evidence.length, 0);
  assert.equal(insights.important[0].pattern.id, "overdose");
});

test("並び順: 要点 → 先生と共有(発言の引用) → 5項目まとめ → 詳しい整理", () => {
  const md = karteInsightsMarkdown(analyzeKarte([u("死にたいと思うことがあります"), u("次回は来週です")])).join("\n");
  assert.ok(md.startsWith("## 1. 診察の重要ポイント"));
  const order = ["1. 診察の重要ポイント", "4. 家族の対応", "先生と必ず共有しておきたいこと", "① 概要", "⑤ 今後の方針", "症状と経過の整理"];
  const positions = order.map((h) => md.indexOf(`## ${h}`));
  assert.ok(positions.every((p) => p >= 0), `見出しが足りない: ${order.filter((_, i) => positions[i] < 0)}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

// --- 要点(1. 重要ポイント / 2. 処方の確認 / 3. 考えられる病気 / 4. 家族の対応) ---

function keyPoints(lines: string[]) {
  return Object.fromEntries(analyzeKarte(lines.map((t) => u(t))).keyPoints.map((s) => [s.heading, s.items]));
}

test("要点: 命の安全を最初に、体・心の症状とつらい体験の話題を短い言葉でまとめる", () => {
  const kp = keyPoints([
    "死にたいと思うことがあります",
    "全身が痛くて、最近は歩けなくなりました",
    "昔の事故のフラッシュバックがあります",
  ]);
  const items = kp["1. 診察の重要ポイント"];
  assert.match(items[0], /^命の安全\(最優先\):死にたい気持ち/);
  assert.ok(items.some((i) => /^体の症状:.*痛み.*歩けない/.test(i)));
  assert.ok(items.some((i) => /^心・トラウマの症状:.*フラッシュバック/.test(i)));
  assert.ok(items.some((i) => /^背景にあるつらい体験の話題:.*事故/.test(i)));
  // 要点には発言そのものは引用しない(短い言葉だけ)
  assert.ok(items.every((i) => !i.includes("「")));
});

test("要点: 過量服薬の話があれば、処方の日数と家族による管理を確認項目に入れる", () => {
  const kp = keyPoints(["前に薬を大量に飲んでしまいました", "リリカは続けてください"]);
  const items = kp["2. 処方の確認"];
  assert.match(items[0], /^日数と管理:/);
  assert.ok(items.some((i) => /^目的と副作用:.*プレガバリン/.test(i)));
});

test("要点: 病気の候補は「診断ではありません」の見出しで、理由を短く添える", () => {
  const kp = keyPoints(["フラッシュバックがあります", "事故の道は避けます"]);
  const items = kp["3. 考えられる病気(候補・診断ではありません)"];
  assert.ok(items.some((i) => /^PTSD.*:フラッシュバック・関係する場所を避ける/.test(i)));
});

test("要点: 家族の対応は、記憶の抜けがあれば代弁を、いつも緊急連絡先の確認を入れる", () => {
  const withMemory = keyPoints(["その頃の記憶がないんです", "フラッシュバックもあります"])["4. 家族の対応"];
  assert.ok(withMemory.some((i) => i.startsWith("診察の代弁:")));
  assert.ok(withMemory.some((i) => i.startsWith("治療の進め方:")));
  assert.ok(withMemory.some((i) => i.startsWith("緊急連絡先:")));

  const plain = keyPoints(["少し頭痛があります"])["4. 家族の対応"];
  assert.deepEqual(plain.map((i) => i.split(":")[0]), ["緊急連絡先"]);
});

test("要点: 症状の話が無ければ、無理に作らない", () => {
  const kp = keyPoints(["今日は晴れていますね"]);
  assert.deepEqual(kp["1. 診察の重要ポイント"], ["症状に関する言葉は見つかりませんでした"]);
  assert.equal(kp["2. 処方の確認"], undefined);
  assert.equal(kp["3. 考えられる病気(候補・診断ではありません)"], undefined);
});
