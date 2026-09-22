"use client";

import { useEffect } from "react";

/** ホーム画面への追加(PWAインストール)を有効にするため、Service Workerを登録する。 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録失敗時もアプリ自体は通常通り使えるので、無視して問題ない
      });
    }
  }, []);

  return null;
}
