import type { ClassifiedUtterance, Mode } from "./types";
import type { KarteInsights } from "./karteInsights";

/**
 * 「全体図」のフィッシュボーン(特性要因図)用のデータ。
 * 右端の「頭」に結論(今の状態/会議の結論)を置き、背骨から伸びる「骨」に要因を並べる。
 *
 * ※ Node のテストランナーで直接読み込めるよう、このファイルは型以外を import しない。
 *   通院カルテは analyzeKarte() の結果を、議事録は分類済みの発言を受け取って組み立てる。
 */

export interface FishboneBone {
  label: string;
  items: string[];
}

export interface FishboneData {
  title: string;
  head: string;
  bones: FishboneBone[];
}

/** 骨1本に並べる項目の上限(多すぎると図が読めなくなる。残りは件数で示す) */
export const MAX_ITEMS_PER_BONE = 5;
const ITEM_MAX_LENGTH = 14;
/** 頭の箱は3行まで折り返せるので、項目より長く載せる */
const HEAD_MAX_LENGTH = 26;

/** 「PTSD(心的外傷後ストレス障害)」→「PTSD」のように、末尾のかっこ書きを省く(半角・全角どちらも) */
const PAREN_SUFFIX = /[((][^()()]*[))]$/;

function shorten(text: string, max = ITEM_MAX_LENGTH): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function limit(items: string[]): string[] {
  const unique = [...new Set(items.filter(Boolean))];
  if (unique.length <= MAX_ITEMS_PER_BONE) return unique;
  return [...unique.slice(0, MAX_ITEMS_PER_BONE - 1), `ほか${unique.length - (MAX_ITEMS_PER_BONE - 1)}件`];
}

export function buildKarteFishbone(insights: KarteInsights): FishboneData {
  const { groups, candidates, drugs, summary } = insights;
  const evidenceOf = (id: string) => summary.find((s) => s.id === id)?.evidence ?? [];

  const head =
    groups.safety.length > 0
      ? `命の安全に注意(${groups.safety.join("・")})`
      : candidates.length > 0
        ? `候補:${candidates.map((c) => c.candidate.name.replace(PAREN_SUFFIX, "")).join("・")}`
        : "今の状態";

  // 同じ発言が「治療と薬」と「今後の予定」の両方に出ないよう、先に使った発言は後の骨に入れない
  const used = new Set<string>();
  const fresh = (id: string) =>
    evidenceOf(id).filter((u) => (used.has(u.id) ? false : (used.add(u.id), true))).map((u) => shorten(u.text));

  const bones: FishboneBone[] = [
    { label: "体の症状", items: limit(groups.body) },
    { label: "心・トラウマの症状", items: limit(groups.mind) },
    { label: "背景のつらい体験", items: limit(groups.hardships) },
    {
      label: "治療と薬",
      items: limit([...drugs.map((d) => d.drug.label.replace(PAREN_SUFFIX, "")), ...fresh("treatment")]),
    },
    { label: "経過", items: limit(fresh("progress")) },
    { label: "今後の予定", items: limit(fresh("plan")) },
  ];

  return { title: "通院カルテ フィッシュボーン", head, bones: bones.filter((b) => b.items.length > 0) };
}

const MEETING_BONES: Array<{ label: string; category: ClassifiedUtterance["category"] }> = [
  { label: "問題点", category: "problem" },
  { label: "解決策", category: "solution" },
  { label: "懸念", category: "concern" },
  { label: "ToDo/宿題", category: "todo" },
  { label: "重要事項", category: "important" },
  { label: "質問・要望", category: "question" },
];

export function buildMeetingFishbone(utterances: ClassifiedUtterance[]): FishboneData {
  const textOf = (u: ClassifiedUtterance) => shorten(u.summary || u.text);
  const decisions = utterances.filter((u) => u.category === "decision");
  const lastDecision = decisions[decisions.length - 1];
  const head = lastDecision ? shorten(lastDecision.summary || lastDecision.text, HEAD_MAX_LENGTH) : "会議の結論(まだ決定事項なし)";
  const bones = MEETING_BONES.map(({ label, category }) => ({
    label,
    items: limit(
      utterances
        .filter((u) => u.category === category || (category === "question" && u.category === "request"))
        .map(textOf)
    ),
  }));
  return { title: "会議フィッシュボーン", head, bones: bones.filter((b) => b.items.length > 0) };
}

/** 文字でコピーするとき用(メモ帳・LINE等に貼れる箇条書き) */
export function fishboneToText(data: FishboneData): string {
  const lines = [`【${data.title}】`, `◆ ${data.head}`];
  if (data.bones.length === 0) lines.push("(まだ内容がありません)");
  for (const bone of data.bones) {
    lines.push("", `■ ${bone.label}`);
    bone.items.forEach((item) => lines.push(`・${item}`));
  }
  return lines.join("\n");
}

export function emptyFishbone(mode: Mode): FishboneData {
  return { title: mode === "karte" ? "通院カルテ フィッシュボーン" : "会議フィッシュボーン", head: "まだ記録がありません", bones: [] };
}
