"use client";

import { useRef, useState } from "react";
import { ScanText, Loader2 } from "lucide-react";
import { extractTextFromFile, OcrProgress } from "@/lib/ocr";

/**
 * 写真/PDFの文字を読み取り、テキストとして親に渡す(親側の入力欄にセットする想定)。
 * OCRの読み取り精度は完璧ではないため、読み取り結果は自動送信せず、
 * 必ず人がテキスト入力欄で見直してから送信する運用にしている。
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
        setErrorMessage("文字を読み取れませんでした。別の写真で試してください。");
        setStatus("error");
        return;
      }
      onExtractedText(text);
      setStatus("idle");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "読み取りに失敗しました");
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
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
        className="flex items-center gap-1 text-xs font-medium text-gray-500 underline underline-offset-2 disabled:opacity-50"
      >
        {status === "loading" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            読み取り中… {Math.round(progress * 100)}%
          </>
        ) : (
          <>
            <ScanText className="h-3.5 w-3.5" />
            写真/PDFを読み込む
          </>
        )}
      </button>
      {status === "error" && errorMessage && <p className="text-xs text-red-600">{errorMessage}</p>}
    </div>
  );
}
