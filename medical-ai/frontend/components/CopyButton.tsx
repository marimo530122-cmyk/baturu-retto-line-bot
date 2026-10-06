"use client";

import { useState } from "react";
import { reportError } from "@/lib/monitoring";

/**
 * 既存の電子カルテ・レセコンへそのまま貼り付けられるよう、プレーンテキストを
 * クリップボードへ一発コピーする大きめのボタン。
 */
export default function CopyButton({
  getText,
  label = "内容をコピー",
}: {
  getText: () => string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    const text = getText();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Clipboard APIが使えない環境(非HTTPS等)向けのフォールバック
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setState("copied");
    } catch (e) {
      reportError(e, { action: "copy-to-clipboard" });
      setState("failed");
    } finally {
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`w-full sm:w-auto px-4 py-2.5 rounded-md text-sm font-semibold transition-colors ${
        state === "copied"
          ? "bg-emerald-600 text-white"
          : state === "failed"
            ? "bg-red-50 text-clinic-danger border border-red-200"
            : "bg-clinic-primary text-white hover:opacity-90"
      }`}
    >
      {state === "copied" ? "✓ コピーしました" : state === "failed" ? "コピーに失敗しました" : `📋 ${label}`}
    </button>
  );
}
