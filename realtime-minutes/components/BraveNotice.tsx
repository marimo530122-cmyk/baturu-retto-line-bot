"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Check, ExternalLink, MicOff } from "lucide-react";

/**
 * Braveブラウザを検出する。
 * Braveは navigator.brave.isBrave() を公式に提供している(他ブラウザには存在しない)。
 * 非同期なので useEffect 内で呼ぶ。
 */
export function useBraveDetection(): boolean {
  const [isBrave, setIsBrave] = useState(false);
  useEffect(() => {
    const brave = (navigator as any).brave;
    if (brave?.isBrave) {
      brave.isBrave().then((result: boolean) => setIsBrave(result)).catch(() => {});
    }
  }, []);
  return isBrave;
}

function useCopyUrl() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      window.prompt("このURLをコピーして、ChromeやSafariに貼り付けてください", href);
    }
  };
  return { copied, copy };
}

/**
 * Braveブラウザ用の全画面オーバーレイ。
 *
 * BraveはデフォルトのプライバシーシールドでHugging Face CDN(Whisperモデル)と
 * Googleの音声認識サーバー(Web Speech API)の両方をブロックするため、
 * どちらの認識器も使えない。
 *
 * 解決策は2つ:
 *   A. ChromeかSafariで開き直す(確実)
 *   B. Brave シールドを無効化してからこのページを使う
 *
 * シールドが無効化されているかどうかをJSから判定する方法がないため、
 * ユーザーが「シールドを無効化して使う」を選んだ場合は録音できる状態にする。
 */
export function BraveOverlay({ onDismissWithShieldOff }: { onDismissWithShieldOff: () => void }) {
  const { copied, copy } = useCopyUrl();

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="brave-overlay-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-gray-900/95 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow-2xl">
        {/* アイコン + タイトル */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
            <MicOff className="h-7 w-7 text-orange-600" />
          </div>
          <h2 id="brave-overlay-title" className="text-lg font-bold leading-snug text-gray-900">
            Braveではそのままでは
            <br />
            録音できません
          </h2>
          <p className="text-sm leading-relaxed text-gray-600">
            Braveのプライバシーシールドが、音声認識で使うサーバーへの接続をブロックしています。
            下記のどちらかで解決できます。
          </p>
        </div>

        {/* 解決策A: Chrome/Safari で開く */}
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="mb-2 text-sm font-bold text-gray-900">解決策A(確実): ChromeかSafariで開く</p>
          <a
            href={`https://www.google.com/chrome/`}
            className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
            onClick={(e) => {
              e.preventDefault();
              const ua = navigator.userAgent;
              const url = window.location.href;
              // Android: Chrome intent
              if (/Android/i.test(ua)) {
                window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=${url.startsWith("https") ? "https" : "http"};package=com.android.chrome;end`;
              } else if (/iPhone|iPad|iPod/i.test(ua)) {
                // iOS: x-safari-https
                window.location.href = url.replace(/^https?:\/\//, (m) =>
                  m === "https://" ? "x-safari-https://" : "x-safari-http://"
                );
              }
            }}
          >
            <ExternalLink className="h-4 w-4" />
            Chromeで開く(Android)
          </a>
          <button
            onClick={copy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gray-900 py-2.5 text-sm font-bold text-gray-900 active:scale-[0.98]"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "コピーしました" : "URLをコピーして他のブラウザに貼る"}
          </button>
        </div>

        {/* 解決策B: シールドを無効化 */}
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="mb-2 text-sm font-bold text-gray-900">
            解決策B: Braveシールドをこのページだけ無効化
          </p>
          <ol className="mb-3 list-decimal pl-4 text-xs leading-relaxed text-gray-600">
            <li>画面右上のライオンアイコン(🦁)をタップ</li>
            <li>「Brave シールド」スイッチを OFF にする</li>
            <li>ページを再読み込みして、録音を試す</li>
          </ol>
          <button
            onClick={onDismissWithShieldOff}
            className="flex w-full items-center justify-center rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 active:scale-[0.98]"
          >
            シールドをOFFにしたので使ってみる
          </button>
        </div>
      </div>
    </div>
  );
}

/** オーバーレイを閉じた後も録音ボタンの上に残す警告バナー */
export function BraveBanner({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <button
      onClick={onOpenGuide}
      className="flex w-full max-w-sm items-start gap-2 rounded-lg border-2 border-orange-400 bg-orange-50 px-3 py-2.5 text-left text-orange-900"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
      <span>
        <span className="block text-sm font-bold">Braveでは録音が制限される場合があります</span>
        <span className="block text-xs">
          シールドがONのままだと失敗します。タップして解決策を表示
        </span>
      </span>
    </button>
  );
}
