"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/monitoring";

/**
 * Next.js App Router のエラーバウンダリ。配下の画面で予期しない例外が起きても
 * 白画面のまま固まらず、ここで再試行ボタン付きの画面を表示する。
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="max-w-lg mx-auto mt-16 text-center space-y-4">
      <p className="text-clinic-danger font-semibold">予期しないエラーが発生しました</p>
      <p className="text-sm text-gray-600">
        画面の表示中に問題が発生しました。入力中のデータが消えていないか確認のうえ、再試行してください。
      </p>
      <button
        onClick={reset}
        className="bg-clinic-accent text-white font-medium px-4 py-2 rounded-md"
      >
        再試行
      </button>
    </div>
  );
}
