"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { buildGoogleCalendarUrl, buildIcsDataUrl } from "@/lib/calendar";

/**
 * 日付はAIが推測せず、必ずユーザーがその場で選ぶ(デフォルトは今日)。
 * 「Googleカレンダー」と「その他(.ics、Apple/Outlook等)」の2択を出す。
 */
export function AddToCalendarButton({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        カレンダーに追加
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <label className="mb-1 block text-xs font-medium text-gray-600">日付</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="flex flex-col gap-1.5">
            <a
              href={buildGoogleCalendarUrl(title, date)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="rounded-md bg-gray-900 px-2 py-1.5 text-center text-xs font-semibold text-white hover:bg-gray-700"
            >
              Googleカレンダーで開く
            </a>
            <a
              href={buildIcsDataUrl(title, date)}
              download={`${title.slice(0, 20)}.ics`}
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              ファイルで保存(iPhone等)
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
