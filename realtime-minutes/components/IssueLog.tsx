import { ClassifiedUtterance } from "@/lib/types";
import { Lightbulb } from "lucide-react";
import { CategoryBadge } from "./CategoryBadge";

const TARGET_CATEGORIES = new Set<ClassifiedUtterance["category"]>(["problem", "solution", "concept"]);

/** 概念・問題点・解決策を時系列順(問題提起→解決策の流れが分かる順)で一覧表示する */
export function IssueLog({ utterances }: { utterances: ClassifiedUtterance[] }) {
  const items = utterances.filter((u) => TARGET_CATEGORIES.has(u.category));

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
        <Lightbulb className="h-8 w-8" />
        <p className="text-sm">まだ概念・問題点・解決策は検出されていません</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {items.map((u) => (
        <li key={u.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <CategoryBadge category={u.category} />
            <span className="text-xs text-gray-400">
              {new Date(u.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <p className="text-sm text-gray-800">{u.summary || u.text}</p>
        </li>
      ))}
    </ul>
  );
}
