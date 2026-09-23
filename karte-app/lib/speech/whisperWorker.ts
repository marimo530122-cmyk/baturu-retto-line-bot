/// <reference lib="webworker" />

// Web Worker本体。ここでだけ @huggingface/transformers を読み込む(メインスレッドや
// SSR時に読み込まれるとモデルロード相当の重い処理がブロッキングで走ってしまうため)。
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Hugging Face Hub上のモデルをブラウザ内にキャッシュして使う(サーバーには音声を送らない)。
env.allowLocalModels = false;

const MODEL_ID = process.env.NEXT_PUBLIC_WHISPER_MODEL || "Xenova/whisper-base";
const DEVICE = (process.env.NEXT_PUBLIC_WHISPER_DEVICE as "wasm" | "webgpu" | undefined) || "wasm";

type ProgressData = {
  status: string;
  progress?: number;
};

type IncomingMessage =
  | { type: "load" }
  | { type: "transcribe"; id: number; audio: Float32Array };

type OutgoingMessage =
  | { type: "ready" }
  | { type: "status"; message: string }
  | { type: "error"; id?: number; message: string }
  | { type: "result"; id: number; text: string };

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function describeProgress(data: ProgressData): string {
  if (data.status === "progress" && typeof data.progress === "number") {
    return `音声モデルを読み込み中…${Math.round(data.progress)}%`;
  }
  return "音声モデルを読み込み中…";
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      device: DEVICE,
      dtype: "q8",
      progress_callback: (data: ProgressData) => {
        post({ type: "status", message: describeProgress(data) });
      },
    });
  }
  return transcriberPromise;
}

function post(message: OutgoingMessage) {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  if (msg.type === "load") {
    try {
      await getTranscriber();
      post({ type: "ready" });
    } catch (err) {
      transcriberPromise = null;
      post({ type: "error", message: toErrorMessage(err) });
    }
    return;
  }

  if (msg.type === "transcribe") {
    try {
      const transcriber = await getTranscriber();
      const output = await transcriber(msg.audio, { language: "japanese", task: "transcribe" });
      const result = Array.isArray(output) ? output[0] : output;
      post({ type: "result", id: msg.id, text: (result?.text ?? "").trim() });
    } catch (err) {
      post({ type: "error", id: msg.id, message: toErrorMessage(err) });
    }
  }
};

export {};
