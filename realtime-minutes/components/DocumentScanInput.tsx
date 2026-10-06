"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { extractTextFromFile, OcrProgress } from "@/lib/ocr";
import { savePhotoHistoryEntry } from "@/lib/photoHistory";
import { savePhotoBlob } from "@/lib/photoStore";
import { createThumbnailBlob } from "@/lib/imageThumbnail";

function makeHistoryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 写真/PDFの文字を読み取り、テキストとして親に渡す(親側の入力欄にセットする想定)。
 * OCRの読み取り精度は完璧ではないため、読み取り結果は自動送信せず、
 * 必ず人がテキスト入力欄で見直してから送信する運用にしている。
 *
 * 録音ボタンの隣に置く想定の大きめの丸ボタン。タップすると(スマホでは)
 * すぐカメラが起動するので、ホワイトボードや資料を録音中でもワンタップで撮れる。
 */
export function DocumentScanInput({
  onExtractedText,
  onReturnFromCapture,
}: {
  onExtractedText: (text: string) => void;
  /** カメラ起動→撮影/キャンセルでこの画面に戻ってきたタイミングで呼ばれる */
  onReturnFromCapture?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openedCameraRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // カメラアプリが前面に出ている間はタブが非表示(hidden)になる。自分でカメラを開いた
  // 直後の可視化だけを「カメラから戻ってきた」と判定し、無関係なタブ切り替えには反応しない。
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && openedCameraRef.current) {
        openedCameraRef.current = false;
        onReturnFromCapture?.();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [onReturnFromCapture]);

  const handleFile = async (file: File) => {
    setStatus("loading");
    setProgress(0);
    setErrorMessage(null);
    const historyId = makeHistoryId();

    // 写真本体の保存(縮小サムネイル)は文字起こしと並行して進める。失敗しても
    // 文字起こし自体には影響させない。
    if (file.type.startsWith("image/")) {
      createThumbnailBlob(file)
        .then((blob) => savePhotoBlob(historyId, blob))
        .catch(() => {
          // サムネイル生成に失敗しても、履歴のテキスト記録自体は続行する
        });
    }

    try {
      const text = await extractTextFromFile(file, (p: OcrProgress) => setProgress(p.progress));
      if (!text) {
        savePhotoHistoryEntry(historyId, "empty", "");
        setErrorMessage("文字を読み取れませんでした。別の写真で試してください。");
        setStatus("error");
        return;
      }
      savePhotoHistoryEntry(historyId, "success", text);
      onExtractedText(text);
      setStatus("idle");
    } catch (e) {
      const message = e instanceof Error ? e.message : "読み取りに失敗しました";
      savePhotoHistoryEntry(historyId, "error", message);
      setErrorMessage(message);
      setStatus("error");
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => {
          openedCameraRef.current = true;
          inputRef.current?.click();
        }}
        disabled={status === "loading"}
        aria-label="写真を撮る"
        title="写真やPDFを読み込んで文字を取り込む"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white shadow-sm transition-all active:scale-95 disabled:opacity-50"
      >
        {status === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        ) : (
          <Camera className="h-6 w-6 text-gray-700" />
        )}
      </button>
      <p className="text-[11px] text-gray-400">
        {status === "loading" ? `読み取り中… ${Math.round(progress * 100)}%` : "写真を撮る"}
      </p>
      {status === "error" && errorMessage && <p className="max-w-[6rem] text-center text-[11px] text-red-600">{errorMessage}</p>}
    </div>
  );
}
