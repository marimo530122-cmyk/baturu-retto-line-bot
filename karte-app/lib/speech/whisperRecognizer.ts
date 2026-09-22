import { SpeechRecognizer } from "./types";

// @ricky0123/vad-web は型定義を持つが、SSR環境で誤って評価されないよう動的importする。
type MicVADInstance = {
  start(): void;
  pause(): Promise<void> | void;
  destroy(): Promise<void> | void;
};

type WorkerMessage =
  | { type: "ready" }
  | { type: "status"; message: string }
  | { type: "error"; id?: number; message: string }
  | { type: "result"; id: number; text: string };

/**
 * Moonshine(Web Speech互換ポリフィル)は日本語トークナイザに対応しておらず日本語では使えなかったため、
 * 代わりに Whisper(多言語対応・日本語モデルもある)を @huggingface/transformers 経由でブラウザ内
 * (Web Worker)で動かす実装。音声は一切サーバーに送らない。
 *
 * 発話区間の検出には @ricky0123/vad-web (Silero VAD) を使う。市場のような雑音下でも、
 * 単純な音量しきい値より無音/有声の判定が安定する。
 */
export class WhisperRecognizer implements SpeechRecognizer {
  private worker: Worker | null = null;
  private vad: MicVADInstance | null = null;
  private loadPromise: Promise<void> | null = null;
  private nextId = 0;
  private listening = false;
  private hasTranscribedSuccessfully = false;

  private finalCallback: ((text: string) => void) | null = null;
  private interimCallback: ((text: string) => void) | null = null;
  private errorCallback: ((message: string) => void) | null = null;
  private statusCallback: ((message: string) => void) | null = null;

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof AudioContext !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  /** 一度もWhisperでの文字起こしに成功していないか(＝起動/モデルロード自体の失敗とみなせるか) */
  hasNeverSucceeded(): boolean {
    return !this.hasTranscribedSuccessfully;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL("./whisperWorker.ts", import.meta.url));
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleWorkerMessage(event.data);
      worker.onerror = () => {
        this.errorCallback?.("音声認識モデルの読み込み中にエラーが発生しました。");
      };
      this.worker = worker;
    }
    return this.worker;
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case "status":
        this.statusCallback?.(msg.message);
        break;
      case "result":
        this.interimCallback?.("");
        if (msg.text) {
          this.hasTranscribedSuccessfully = true;
          this.finalCallback?.(msg.text);
        }
        break;
      case "error":
        this.errorCallback?.(msg.message || "音声認識でエラーが発生しました。");
        break;
      default:
        break;
    }
  }

  private load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = new Promise<void>((resolve, reject) => {
        const worker = this.ensureWorker();
        const onMessage = (event: MessageEvent<WorkerMessage>) => {
          if (event.data.type === "ready") {
            worker.removeEventListener("message", onMessage);
            resolve();
          } else if (event.data.type === "error" && event.data.id === undefined) {
            worker.removeEventListener("message", onMessage);
            reject(new Error(event.data.message));
          }
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ type: "load" });
      });
    }
    return this.loadPromise;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    void this.startInternal();
  }

  private async startInternal(): Promise<void> {
    try {
      this.statusCallback?.("音声モデルを読み込み中…(初回のみ数十秒かかることがあります)");
      await this.load();
      this.statusCallback?.("");

      if (!this.vad) {
        const { MicVAD } = await import("@ricky0123/vad-web");
        this.vad = (await MicVAD.new({
          onSpeechStart: () => {
            this.interimCallback?.("聞き取り中");
          },
          onVADMisfire: () => {
            this.interimCallback?.("");
          },
          onSpeechEnd: (audio: Float32Array) => {
            this.interimCallback?.("文字起こし中");
            const id = this.nextId++;
            this.ensureWorker().postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
          },
        })) as MicVADInstance;
      }

      this.vad.start();
    } catch (err) {
      this.listening = false;
      this.errorCallback?.(
        err instanceof Error ? err.message : "音声認識モデルの起動に失敗しました。"
      );
    }
  }

  stop(): void {
    this.listening = false;
    void this.vad?.pause();
    this.interimCallback?.("");
  }

  onFinalResult(callback: (text: string) => void): void {
    this.finalCallback = callback;
  }

  onInterimResult(callback: (text: string) => void): void {
    this.interimCallback = callback;
  }

  onError(callback: (message: string) => void): void {
    this.errorCallback = callback;
  }

  onStatus(callback: (message: string) => void): void {
    this.statusCallback = callback;
  }
}
