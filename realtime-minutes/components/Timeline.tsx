"use client";

import { ClassifiedUtterance } from "@/lib/types";
import { CategoryBadge } from "./CategoryBadge";
import { MicOff } from "lucide-react";
import { useEffect, useRef } from "react";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Timeline({
  utterances,
  interimText,
}: {
  utterances: ClassifiedUtterance[];
  interimText: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新しい発言・認識中テキストが増えたら最新行が見えるように自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [utterances.length, interimText]);

  if (utterances.length === 0 && !interimText) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
        <MicOff className="h-8 w-8" />
        <p className="text-sm">「録音開始」を押すと発言がここに流れます</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
      {utterances.map((u) => (
        <div key={u.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <CategoryBadge category={u.category} />
            <span className="text-xs text-gray-400">{formatTime(u.timestamp)}</span>
          </div>
          <p className="text-sm text-gray-800">{u.text}</p>
        </div>
      ))}
      {interimText && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-400">
          {interimText}…
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
