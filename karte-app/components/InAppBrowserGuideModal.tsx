"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, X } from "lucide-react";
import { InAppBrowserInfo } from "@/lib/inAppBrowser";

interface Props {
  info: InAppBrowserInfo;
  url: string;
  onClose: () => void;
}

/** アプリ内ブラウザでは録音(マイク)が使えないため、通常ブラウザで開き直すよう案内するモーダル */
export function InAppBrowserGuideModal({ info, url, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex w-full items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            ブラウザで開いてください
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-center text-xs text-gray-600">
          {info.label}内のブラウザでは録音(マイク)が使えません。右上のメニューから
          「ブラウザで開く」を選ぶか、下のボタンでURLをコピーしてChrome/Safariで開き直してください。
        </p>

        <p className="w-full break-all rounded-lg bg-gray-50 p-2 text-center text-xs text-gray-400">{url}</p>

        <button
          onClick={handleCopy}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rose-700 py-2.5 text-sm font-semibold text-white hover:bg-rose-800"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "コピーしました" : "URLをコピー"}
        </button>
      </div>
    </div>
  );
}
