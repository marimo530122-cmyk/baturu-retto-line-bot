import { SpeechRecognizer } from "./types";

/**
 * ブラウザ標準 Web Speech API を使った実装。
 * 将来 whisper.cpp(WASM) 等に差し替える場合は、この SpeechRecognizer
 * インターフェースを満たす別クラスを作って main の呼び出し元で切り替えるだけでよい。
 */
export class WebSpeechRecognizer implements SpeechRecognizer {
  private recognition: any = null;
  private finalCallback: ((text: string) => void) | null = null;
  private interimCallback: ((text: string) => void) | null = null;
  private errorCallback: ((message: string) => void) | null = null;

  constructor(lang: string = "ja-JP") {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          this.finalCallback?.(transcript.trim());
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        this.interimCallback?.(interim.trim());
      }
    };

    recognition.onerror = (event: any) => {
      this.errorCallback?.(event.error ?? "unknown speech recognition error");
    };

    // 無音等でセッションが切れた場合、録音継続中なら自動再開する
    recognition.onend = () => {
      if (this.shouldRestart) {
        try {
          recognition.start();
        } catch {
          // すでに開始済みの場合などは無視
        }
      }
    };

    this.recognition = recognition;
  }

  private shouldRestart = false;

  isSupported(): boolean {
    return this.recognition !== null;
  }

  start(): void {
    if (!this.recognition) return;
    this.shouldRestart = true;
    try {
      this.recognition.start();
    } catch {
      // 既に開始している場合は無視
    }
  }

  stop(): void {
    if (!this.recognition) return;
    this.shouldRestart = false;
    this.recognition.stop();
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
}
