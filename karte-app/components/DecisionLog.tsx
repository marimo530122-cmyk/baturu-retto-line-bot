import { ClassifiedUtterance } from "@/lib/types";
import { Pin } from "lucide-react";

export function DecisionLog({ utterances }: { utterances: ClassifiedUtterance[] }) {
  const decisions = [...utterances].filter((u) => u.category === "decision").reverse();

  if (decisions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
        <Pin className="h-8 w-8" />
        <p className="text-sm">まだ決定事項はありません</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Pin className="h-3 w-3" />
            {new Date(d.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <p className="text-sm text-emerald-900">{d.summary || d.text}</p>
        </li>
      ))}
    </ul>
  );
}
