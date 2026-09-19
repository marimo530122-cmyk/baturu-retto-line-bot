"use client";

import { useState } from "react";
import { Network, ListTodo, Pin, FileText } from "lucide-react";
import { ClassifiedUtterance } from "@/lib/types";
import { MindMapView } from "./MindMapView";
import { TodoList } from "./TodoList";
import { DecisionLog } from "./DecisionLog";
import { SummaryView } from "./SummaryView";
import { utterancesToMarkdown } from "@/lib/markmapTransform";
import { utterancesToSummaryMarkdown } from "@/lib/summaryTransform";

type InsightTab = "mindmap" | "todo" | "decisions" | "summary";

const TABS: Array<{ id: InsightTab; label: string; icon: typeof Network }> = [
  { id: "mindmap", label: "マインドマップ", icon: Network },
  { id: "todo", label: "ToDo/宿題", icon: ListTodo },
  { id: "decisions", label: "決定事項", icon: Pin },
  { id: "summary", label: "サマリー", icon: FileText },
];

export function InsightPanel({
  utterances,
  onToggleTodo,
}: {
  utterances: ClassifiedUtterance[];
  onToggleTodo: (id: string) => void;
}) {
  const [tab, setTab] = useState<InsightTab>("mindmap");

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-white px-2 py-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === id ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 bg-gray-50">
        {tab === "mindmap" && <MindMapView markdown={utterancesToMarkdown(utterances)} />}
        {tab === "todo" && <TodoList utterances={utterances} onToggle={onToggleTodo} />}
        {tab === "decisions" && <DecisionLog utterances={utterances} />}
        {tab === "summary" && <SummaryView markdown={utterancesToSummaryMarkdown(utterances)} />}
      </div>
    </div>
  );
}
