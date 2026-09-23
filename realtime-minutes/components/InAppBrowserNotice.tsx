"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Copy, Check, AlertTriangle, MicOff } from "lucide-react";
import { buildExternalBrowserUrl, detectInAppBrowser } from "@/lib/inAppBrowser";

/** アプリ内ブラウザならアプリ名を返す(判定は描画後にクライアント側で行う。通常のブラウザでは null) */
export function useInAppBrowser(): string | null {
  const [appName, setAppName] = useState<string | null>(null);
  useEffect(() => {
    setAppName(detectInAppBrowser(navigator.userAgent));
  }, []);
  return appName;
}

function useCopyUrl() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      // アプリ内ブラウザではクリップボードAPIが使えないことがあるので、手動コピー用に表示する
      window.prompt("このURLをコピーして、ChromeやSafariに貼り付けてください", href);
    }
  };
  return { copied, copy };
}

/**
 * TikTok/LINE/Instagram等のアプリ内ブラウザではマイクの許可が出ず、音声認識が
 * "not-allowed" で失敗する。何より先に標準ブラウザで開き直してもらうため、画面全体を覆って案内する。
 */
export function InAppBrowserOverlay({ appName, onDismiss }: { appName: string; onDismiss: () => void }) {
  const { copied, copy } = useCopyUrl();
  const [externalUrl, setExternalUrl] = useState<string | null>(null);

  useEffect(() => {
    setExternalUrl(buildExternalBrowserUrl(appName, window.location.href, navigator.userAgent));
  }, [appName]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="in-app-browser-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-gray-900/95 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <MicOff className="h-7 w-7 text-red-600" />
        </div>
        <h2 id="in-app-browser-title" className="text-lg font-bold leading-snug text-gray-900">
          右上のメニュー等から
          <br />
          ChromeやSafariで開き直してください
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          いま<strong>{appName}</strong>のアプリ内ブラウザで開いています。この画面ではマイクが使えないため、
          録音できません。
        </p>

        {externalUrl && (
          <a
            href={externalUrl}
            className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 py-3.5 text-base font-bold text-white active:scale-[0.98]"
          >
            <ExternalLink className="h-5 w-5" />
            標準ブラウザで開く
          </a>
        )}
        <button
          onClick={copy}
          className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-base font-bold active:scale-[0.98] ${
            externalUrl ? "border-2 border-gray-900 text-gray-900" : "bg-gray-900 text-white"
          }`}
        >
          {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
          {copied ? "コピーしました" : "URLをコピーする"}
        </button>

        <ol className="list-decimal rounded-lg bg-gray-50 py-3 pl-8 pr-3 text-left text-xs leading-relaxed text-gray-600">
          <li>画面右上の「…」や「⋮」、共有ボタンをタップ</li>
          <li>「ブラウザで開く」「Safariで開く」「Chromeで開く」を選ぶ</li>
          <li>見つからない場合は「URLをコピーする」を押し、ChromeやSafariのアドレス欄に貼り付け</li>
        </ol>

        <button onClick={onDismiss} className="text-xs text-gray-400 underline underline-offset-2">
          このまま文字入力だけで使う(録音はできません)
        </button>
      </div>
    </div>
  );
}

/** オーバーレイを閉じた後も録音ボタンの上に出し続ける案内 */
export function InAppBrowserBanner({ appName, onOpenGuide }: { appName: string; onOpenGuide: () => void }) {
  return (
    <button
      onClick={onOpenGuide}
      className="flex w-full max-w-sm items-start gap-2 rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2.5 text-left text-red-900"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <span>
        <span className="block text-sm font-bold">ChromeやSafariなどの標準ブラウザで開いてください</span>
        <span className="block text-xs">
          {appName}のアプリ内ブラウザでは録音できません。タップして開き直す方法を表示
        </span>
      </span>
    </button>
  );
}
