"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

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

/**
 * Braveブラウザで開いているとき、録音ボタンの上に注意バナーを表示する。
 * Braveはデフォルトでプライバシーシールドが有効なため、
 * Web Speech API が使う Google の音声認識サーバーへの通信がブロックされ
 * "network" エラーになる。
 * ブロックを解除する手順か、Chrome/Safari への切り替えを案内する。
 */
export function BraveNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-amber-900">
      <p className="flex items-start gap-1.5 text-sm font-bold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        Braveでは音声認識がブロックされます
      </p>
      <p className="text-xs leading-relaxed">
        BraveのプライバシーシールドがGoogleの音声認識サーバーをブロックしているため、録音しても
        「接続できません」エラーになります。
      </p>
      <ul className="list-disc pl-4 text-xs leading-relaxed text-amber-800">
        <li>
          <strong>解決策①(推奨)</strong>: このページを
          <strong>ChromeかSafari</strong>で開き直す
        </li>
        <li>
          <strong>解決策②</strong>: 右上のBraveシールドアイコン(ライオン)をタップ →
          「このサイトのシールドを無効化」
        </li>
      </ul>
      <button
        onClick={onDismiss}
        className="self-end text-xs text-amber-600 underline underline-offset-2"
      >
        わかった（閉じる）
      </button>
    </div>
  );
}
