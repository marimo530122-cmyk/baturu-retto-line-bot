"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { extractTextFromFile, OcrProgress } from "@/lib/ocr";
import { savePhotoHistoryEntry } from "@/lib/photoHistory";

/**
 * 写真/PDFの文字を読み取り、テキストとして親に渡す(親側の入力欄にセットする想定)。
 * OCRの読み取り精度は完璧ではないため、読み取り結果は自動送信せず、
 * 必ず人がテキスト入力欄で見直してから送信する運用にしている。
 *
 * 録音ボタンの隣に置く想定の大きめの丸ボタン。タップすると(スマホでは)
 * すぐカメラが起動するので、ホワイトボードや資料を録音中でもワンタップで撮れる。
 */
export function DocumentScanInput({ onExtractedText }: { onExtractedText: (text: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setStatus("loading");
    setProgress(0);
    setErrorMessage(null);
    try {
      const text = await extractTextFromFile(file, (p: OcrProgress) => setProgress(p.progress));
      if (!text) {
        savePhotoHistoryEntry("empty", "");
        setErrorMessage("文字を読み取れませんでした。別の写真で試してください。");
        setStatus("error");
        return;
      }
      savePhotoHistoryEntry("success", text);
      onExtractedText(text);
      setStatus("idle");
    } catch (e) {
      const message = e instanceof Error ? e.message : "読み取りに失敗しました";
      savePhotoHistoryEntry("error", message);
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
        onClick={() => inputRef.current?.click()}
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
