export const CATEGORIES = [
  "decision",
  "todo",
  "question",
  "concern",
  "request",
  "important",
  "smalltalk",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  decision: "決定事項",
  todo: "宿題",
  question: "質問",
  concern: "懸念",
  request: "要望",
  important: "重要事項",
  smalltalk: "雑談",
};

export const CATEGORY_COLOR: Record<Category, { bg: string; text: string; dot: string }> = {
  decision: { bg: "bg-emerald-100", text: "text-emerald-800", dot: "bg-emerald-500" },
  todo: { bg: "bg-blue-100", text: "text-blue-800", dot: "bg-blue-500" },
  question: { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  concern: { bg: "bg-red-100", text: "text-red-800", dot: "bg-red-500" },
  request: { bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  important: { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500" },
  smalltalk: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
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
