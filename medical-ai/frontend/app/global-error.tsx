"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/monitoring";

/** ルートレイアウト自体が例外を投げた場合の最終防衛ライン。 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, { digest: error.digest, scope: "global" });
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
          <p style={{ fontWeight: 600, color: "#dc2626" }}>アプリの読み込み中にエラーが発生しました</p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 6,
              border: "none",
            }}
          >
            再読み込み
          </button>
        </div>
      </body>
    </html>
  );
}
