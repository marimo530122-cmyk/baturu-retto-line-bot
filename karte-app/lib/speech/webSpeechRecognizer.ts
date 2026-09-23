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
      const code = event.error;
      // "no-speech"(無音が続いただけ)と "aborted"(自動再開に伴う中断)は
      // onend側で自動的に聞き直すため、正常な動作の一部。エラー表示すると
      // 「喋っても反応してない」ように見えてしまうので画面には出さない。
      if (code === "no-speech" || code === "aborted") return;

      const message: Record<string, string> = {
        "not-allowed": "マイクの使用が許可されていません。ブラウザの設定でマイクへのアクセスを許可してください。",
        "service-not-allowed": "マイクの使用が許可されていません。ブラウザの設定でマイクへのアクセスを許可してください。",
        "audio-capture": "マイクが見つかりません。マイクの接続や、他のアプリで使用中でないか確認してください。",
        network: "通信状態が悪く音声認識が中断されました。電波の良い場所でもう一度お試しください。",
      };
      this.errorCallback?.(message[code] ?? "音声認識でエラーが発生しました。もう一度タップしてみてください。");
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
