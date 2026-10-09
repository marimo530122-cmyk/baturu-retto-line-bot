// 全体図のフィッシュボーンのテスト。※文はすべて作り話(実際の記録は使わない)
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeKarte } from "../lib/karteInsights.ts";
import { buildKarteFishbone, buildMeetingFishbone, fishboneToText, MAX_ITEMS_PER_BONE } from "../lib/fishbone.ts";

let clock = Date.UTC(2026, 0, 1, 1, 0, 0);
function u(text: string, category = "other", summary?: string) {
  clock += 10_000;
  return { id: String(clock), text, category: category as any, summary: summary ?? text.slice(0, 20), importance: 1 as const, timestamp: clock };
}

test("通院カルテ: 体・心・背景・治療・経過・今後の骨に振り分ける", () => {
  const fb = buildKarteFishbone(
    analyzeKarte([
      u("全身が痛くて歩けなくなりました"),
      u("昔の事故のフラッシュバックがあります"),
      u("リリカを続けて処方しておきます"),
      u("前回より眠れるようになりましたね"),
      u("次回は2週間後に予約を取ってください"),
    ])
  );
  const bone = (label: string) => fb.bones.find((b) => b.label === label)?.items ?? [];
  assert.ok(bone("体の症状").includes("痛み"));
  assert.ok(bone("心・トラウマの症状").includes("フラッシュバック"));
  assert.ok(bone("背景のつらい体験").includes("事故"));
  assert.ok(bone("治療と薬").includes("プレガバリン"));
  assert.ok(bone("経過").some((i) => i.startsWith("前回より")));
  assert.ok(bone("今後の予定").some((i) => i.startsWith("次回は")));
});

test("通院カルテ: 命の安全の話があれば、頭(結論)にそれを出す", () => {
  const fb = buildKarteFishbone(analyzeKarte([u("死にたいと思うことがあります")]));
  assert.match(fb.head, /^命の安全に注意/);
});

test("通院カルテ: 頭には病名候補を、かっこ書きを省いた短い名前で出す", () => {
  const fb = buildKarteFishbone(analyzeKarte([u("フラッシュバックがあります"), u("事故の道は避けます")]));
  assert.equal(fb.head, "候補:PTSD");
});

test("通院カルテ: 中身の無い骨は描かない", () => {
  const fb = buildKarteFishbone(analyzeKarte([u("少し頭痛があります")]));
  assert.deepEqual(fb.bones.map((b) => b.label), ["体の症状"]);
});

test("議事録: 頭は最後の決定事項、骨は問題点・解決策など", () => {
  const fb = buildMeetingFishbone([
    u("在庫が足りない", "problem"),
    u("仕入れ先を増やす", "solution"),
    u("来月から新しい仕入れ先に切り替える", "decision"),
  ]);
  assert.equal(fb.head, "来月から新しい仕入れ先に切り替える");
  assert.deepEqual(fb.bones.map((b) => b.label), ["問題点", "解決策"]);
});

test("1本の骨に載せる項目は上限までにし、残りは件数で示す", () => {
  const many = Array.from({ length: MAX_ITEMS_PER_BONE + 3 }, (_, i) => u(`問題その${i + 1}`, "problem"));
  const items = buildMeetingFishbone(many).bones[0].items;
  assert.equal(items.length, MAX_ITEMS_PER_BONE);
  assert.equal(items[items.length - 1], "ほか4件");
});

test("文字でコピー用の書き出し", () => {
  const text = fishboneToText(buildMeetingFishbone([u("在庫が足りない", "problem"), u("増やす", "decision")]));
  assert.equal(text, "【会議フィッシュボーン】\n◆ 増やす\n\n■ 問題点\n・在庫が足りない");
});
