import { ClassifiedUtterance } from "@/lib/types";
import { ListTodo } from "lucide-react";
import { AddToCalendarButton } from "./AddToCalendarButton";

export function TodoList({
  utterances,
  onToggle,
}: {
  utterances: ClassifiedUtterance[];
  onToggle: (id: string) => void;
}) {
  const todos = utterances.filter((u) => u.category === "todo");

  if (todos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
        <ListTodo className="h-8 w-8" />
        <p className="text-sm">まだToDo/宿題は検出されていません</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {todos.map((t) => (
        <li key={t.id} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <input
            type="checkbox"
            checked={!!t.done}
            onChange={() => onToggle(t.id)}
            className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
          />
          <span className={`flex-1 text-sm ${t.done ? "text-gray-400 line-through" : "text-gray-800"}`}>
            {t.summary || t.text}
          </span>
          <AddToCalendarButton title={t.summary || t.text} />
        </li>
      ))}
    </ul>
  );
}
