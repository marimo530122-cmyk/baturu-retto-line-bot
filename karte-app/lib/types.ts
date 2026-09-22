export type Mode = "meeting" | "karte";

export const MEETING_CATEGORIES = [
  "decision",
  "todo",
  "question",
  "concern",
  "request",
  "important",
  "smalltalk",
] as const;
export type MeetingCategory = (typeof MEETING_CATEGORIES)[number];

export const KARTE_CATEGORIES = [
  "symptom",
  "decision",
  "treatment",
  "appointment",
  "worry",
  "other",
] as const;
export type KarteCategory = (typeof KARTE_CATEGORIES)[number];

export const CATEGORIES = [...new Set([...MEETING_CATEGORIES, ...KARTE_CATEGORIES])] as Category[];
export type Category = MeetingCategory | KarteCategory;

export const CATEGORIES_BY_MODE: Record<Mode, readonly Category[]> = {
  meeting: MEETING_CATEGORIES,
  karte: KARTE_CATEGORIES,
};

/** 分類が判定できない/該当なしのときのフォールバック先。各カテゴリ配列の末尾。 */
export const DEFAULT_CATEGORY_BY_MODE: Record<Mode, Category> = {
  meeting: "smalltalk",
  karte: "other",
};

export const MODE_META: Record<Mode, { title: string; subtitle: string }> = {
  meeting: { title: "リアルタイム議事録", subtitle: "音声 → 7分類 → マインドマップ をリアルタイム生成" },
  karte: { title: "通院カルテ", subtitle: "音声 → 症状・診断・処方を自動で記録" },
};

export const CATEGORY_LABEL: Record<Category, string> = {
  decision: "決定事項",
  todo: "宿題",
  question: "質問",
  concern: "懸念",
  request: "要望",
  important: "重要事項",
  smalltalk: "雑談",
  symptom: "症状",
  treatment: "処方・治療",
  appointment: "次回の予約",
  worry: "気になること・質問",
  other: "その他",
};

export const CATEGORY_COLOR: Record<Category, { bg: string; text: string; dot: string }> = {
  decision: { bg: "bg-emerald-100", text: "text-emerald-800", dot: "bg-emerald-500" },
  todo: { bg: "bg-blue-100", text: "text-blue-800", dot: "bg-blue-500" },
  question: { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  concern: { bg: "bg-red-100", text: "text-red-800", dot: "bg-red-500" },
  request: { bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  important: { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500" },
  smalltalk: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
  symptom: { bg: "bg-rose-100", text: "text-rose-800", dot: "bg-rose-500" },
  treatment: { bg: "bg-sky-100", text: "text-sky-800", dot: "bg-sky-500" },
  appointment: { bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-indigo-500" },
  worry: { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  other: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
};

export interface ClassifiedUtterance {
  id: string;
  text: string;
  category: Category;
  summary: string;
  importance: 1 | 2 | 3;
  timestamp: number;
  done?: boolean;
}

export interface ClassifyResult {
  category: Category;
  summary: string;
  importance: 1 | 2 | 3;
}
