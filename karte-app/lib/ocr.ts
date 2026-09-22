/**
 * ブラウザ内で完結する無料OCR(Tesseract.js)。サーバーにもクラウドAPIにも送らない。
 * 日本語の学習データ(数MB)は初回のみ、Tesseract.jsの既定CDNから読み込まれる
 * (通信を使うが、追加の利用料金は発生しない)。
 *
 * PDFは画像ではないため、まずPDF.jsでページを画像(canvas)に描画してからOCRに渡す。
 * 土台実装として、PDFは1ページ目のみ対応(複数ページの領収書等は今後の課題)。
 */

export interface OcrProgress {
  status: string;
  progress: number; // 0..1
}

async function recognizeImageSource(
  source: Blob | HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("jpn+eng", undefined, {
    logger: onProgress
      ? (m) => {
          if (typeof m.progress === "number") onProgress({ status: m.status, progress: m.progress });
        }
      : undefined,
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(source);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}

async function pdfFirstPageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d context を取得できませんでした");

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

/** 画像ファイルまたはPDFファイル(1ページ目)から文字を読み取る。 */
export async function extractTextFromFile(file: File, onProgress?: (p: OcrProgress) => void): Promise<string> {
  if (file.type === "application/pdf") {
    const canvas = await pdfFirstPageToCanvas(file);
    return recognizeImageSource(canvas, onProgress);
  }
  if (file.type.startsWith("image/")) {
    return recognizeImageSource(file, onProgress);
  }
  throw new Error("対応していないファイル形式です(画像またはPDFのみ)");
}
