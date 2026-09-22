"use client";

import { useState } from "react";
import { Copy, Check, Share2, LayoutList, Code } from "lucide-react";
import { parseMarkdownSections } from "@/lib/markdownSections";

type ViewMode = "simple" | "markdown";

export function SummaryView({ markdown, shareTitle }: { markdown: string; shareTitle?: string }) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("simple");
  const [shareState, setShareState] = useState<"idle" | "done" | "unsupported">("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード権限がない場合は無視
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: shareTitle || "記録", text: markdown });
        setShareState("done");
      } catch {
        // ユーザーがキャンセルした場合等は何もしない
      }
    } else {
      setShareState("unsupported");
      setTimeout(() => setShareState("idle"), 2500);
    }
  };

  const parsed = parseMarkdownSections(markdown);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
          <button
            onClick={() => setViewMode("simple")}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              viewMode === "simple" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
          >
            <LayoutList className="h-3.5 w-3.5" /> かんたん表示
          </button>
          <button
            onClick={() => setViewMode("markdown")}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              viewMode === "markdown" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
          >
            <Code className="h-3.5 w-3.5" /> Markdown
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={handleShare}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Share2 className="h-3.5 w-3.5" />
            {shareState === "unsupported" ? "この端末では未対応(コピーをご利用ください)" : "共有"}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "コピーしました" : "コピー"}
          </button>
        </div>
      </div>

      {viewMode === "markdown" ? (
        <pre className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-800">
          {markdown}
        </pre>
      ) : (
        <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
          {parsed.title && <h2 className="mb-1 text-lg font-bold text-gray-900">{parsed.title}</h2>}
          {parsed.meta.length > 0 && (
            <p className="mb-4 text-sm text-gray-500">{parsed.meta.join(" / ")}</p>
          )}
          {parsed.sections.length === 0 && (
            <p className="text-sm text-gray-400">まだ内容がありません</p>
          )}
          <div className="flex flex-col gap-4">
            {parsed.sections.map((section, i) => (
              <div key={i}>
                <h3 className="mb-1.5 text-sm font-semibold text-gray-900">{section.heading}</h3>
                {section.items.length === 0 ? (
                  <p className="text-sm text-gray-400">(なし)</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {section.items.map((item, j) => (
                      <li key={j} className="rounded-md bg-gray-50 px-3 py-2 text-base leading-relaxed text-gray-800">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
