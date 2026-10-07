"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";

const STORAGE_KEY = "realtime-minutes:privacy-notice-dismissed";

/**
 * 発言・写真が外部AIに送られる旨を一度だけ知らせる通知。
 * 初期値は非表示にしておき、useEffectでlocalStorageを確認してから出す
 * (SSR/クライアントで表示が一致しないチラつきを防ぐため)。
 */
export function PrivacyNotice() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // 保存に失敗しても閉じる動作自体は成立させる
    }
  };

  return (
    <div className="flex shrink-0 items-start gap-2 bg-sky-50 px-4 py-2 text-xs text-sky-800">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">
        発言・写真の内容は分類のため外部のAIに送信されます。記録はこの端末のブラウザ内にのみ保存され、
        サーバー側には保存されません。
      </p>
      <button onClick={handleDismiss} className="shrink-0 text-sky-600 hover:text-sky-900" aria-label="閉じる">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
