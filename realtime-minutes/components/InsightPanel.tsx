"use client";

import { useEffect, useState } from "react";
import { Network, ListTodo, Pin, FileText, CalendarClock } from "lucide-react";
import { ClassifiedUtterance, Mode } from "@/lib/types";
import { MindMapView } from "./MindMapView";
import { TodoList } from "./TodoList";
import { DecisionLog } from "./DecisionLog";
import { AppointmentList } from "./AppointmentList";
import { SummaryView } from "./SummaryView";
import { utterancesToMarkdown } from "@/lib/markmapTransform";
import { utterancesToSummaryMarkdown } from "@/lib/summaryTransform";

type InsightTab = "mindmap" | "todo" | "appointment" | "decisions" | "summary";

const TABS_BY_MODE: Record<Mode, Array<{ id: InsightTab; label: string; icon: typeof Network }>> = {
  meeting: [
    { id: "mindmap", label: "マインドマップ", icon: Network },
    { id: "todo", label: "ToDo/宿題", icon: ListTodo },
    { id: "decisions", label: "決定事項", icon: Pin },
    { id: "summary", label: "サマリー", icon: FileText },
  ],
  karte: [
    { id: "mindmap", label: "全体図", icon: Network },
    { id: "decisions", label: "診断・決定", icon: Pin },
    { id: "appointment", label: "次回の予約", icon: CalendarClock },
    { id: "summary", label: "カルテ", icon: FileText },
  ],
};

export function InsightPanel({
  utterances,
  onToggleTodo,
  mode = "meeting",
}: {
  utterances: ClassifiedUtterance[];
  onToggleTodo: (id: string) => void;
  mode?: Mode;
}) {
  const tabs = TABS_BY_MODE[mode];
  const [tab, setTab] = useState<InsightTab>(tabs[0].id);

  // モード切り替え時、そのモードに存在しないタブが選ばれたままにならないようにする
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [mode, tab, tabs]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-white px-2 py-1.5">
        {tabs.map(({ id, label, icon: Icon }) => (
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
        {tab === "mindmap" && <MindMapView markdown={utterancesToMarkdown(utterances, mode)} />}
        {tab === "todo" && <TodoList utterances={utterances} onToggle={onToggleTodo} />}
        {tab === "appointment" && <AppointmentList utterances={utterances} />}
        {tab === "decisions" && <DecisionLog utterances={utterances} />}
        {tab === "summary" && (
          <SummaryView
            markdown={utterancesToSummaryMarkdown(utterances, mode)}
            shareTitle={mode === "karte" ? "通院カルテ" : "議事録"}
          />
        )}
      </div>
    </div>
  );
}
