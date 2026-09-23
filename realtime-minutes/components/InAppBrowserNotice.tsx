"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { detectInAppBrowser } from "@/lib/inAppBrowser";

/**
 * TikTok/LINE/Instagram等のアプリ内ブラウザでは音声認識やマイクが使えないことが多いため、
 * 標準ブラウザで開き直すよう案内する。判定は描画後(クライアント側)に行い、
 * 通常のブラウザでは何も表示しない。
 */
export function InAppBrowserNotice() {
  const [appName, setAppName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAppName(detectInAppBrowser(navigator.userAgent));
  }, []);

  if (!appName) return null;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      window.prompt("このURLをコピーして、ChromeやSafariに貼り付けてください", window.location.href);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <ExternalLink className="h-4 w-4 shrink-0" />
        ChromeやSafariなどの標準ブラウザで開いてください
      </p>
      <p className="mt-1 text-xs leading-relaxed">
        {appName}のアプリ内ブラウザでは録音(マイク)が使えないことがあります。画面右上の「…」などから
        「ブラウザで開く」を選ぶか、URLをコピーして標準ブラウザに貼り付けてください。
      </p>
      <button
        onClick={copyUrl}
        className="mt-2 flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "コピーしました" : "URLをコピー"}
      </button>
    </div>
  );
}
