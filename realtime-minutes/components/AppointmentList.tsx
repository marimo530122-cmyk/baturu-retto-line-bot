import { ClassifiedUtterance } from "@/lib/types";
import { CalendarClock } from "lucide-react";
import { AddToCalendarButton } from "./AddToCalendarButton";

export function AppointmentList({ utterances }: { utterances: ClassifiedUtterance[] }) {
  const appointments = [...utterances].filter((u) => u.category === "appointment").reverse();

  if (appointments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
        <CalendarClock className="h-8 w-8" />
        <p className="text-sm">まだ次回の予約に関する話は検出されていません</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {appointments.map((a) => (
        <li key={a.id} className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <div className="mb-1 flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 text-xs font-medium text-indigo-700">
              <CalendarClock className="h-3 w-3" />
              {new Date(a.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <AddToCalendarButton title={a.summary || a.text} />
          </div>
          <p className="text-sm text-indigo-900">{a.summary || a.text}</p>
        </li>
      ))}
    </ul>
  );
}
