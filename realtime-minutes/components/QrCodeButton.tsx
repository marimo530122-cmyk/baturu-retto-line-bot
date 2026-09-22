"use client";

import { useEffect, useState } from "react";
import { QrCode, X } from "lucide-react";
import QRCode from "qrcode";

/** PCで開いている画面のURLをQRコード化し、スマホのカメラで読み取って開けるようにする。 */
export function QrCodeButton() {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const currentUrl = window.location.origin + window.location.pathname;
    setUrl(currentUrl);
    QRCode.toDataURL(currentUrl, { width: 240, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
        title="スマホで開くQRコード"
      >
        <QrCode className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl bg-white p-6 shadow-xl">
            <div className="flex w-full items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">スマホのカメラで読み取る</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt="このアプリを開くQRコード" className="h-60 w-60" />
            ) : (
              <div className="flex h-60 w-60 items-center justify-center text-xs text-gray-400">生成中…</div>
            )}
            <p className="break-all text-center text-xs text-gray-400">{url}</p>
          </div>
        </div>
      )}
    </>
  );
}
