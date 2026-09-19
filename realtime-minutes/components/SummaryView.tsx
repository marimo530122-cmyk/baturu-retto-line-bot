"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function SummaryView({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード権限がない場合は無視
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex justify-end">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "コピーしました" : "Markdownをコピー"}
        </button>
      </div>
      <pre className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-800">
        {markdown}
      </pre>
    </div>
  );
}
