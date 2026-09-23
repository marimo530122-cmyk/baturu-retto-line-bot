import { SpeechRecognizer } from "./types";

const DUPLICATE_WINDOW_MS = 3000;

/** 自動再開しても直らないエラー(再開し続けるとエラーが延々と出るので止める) */
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "マイクの使用が許可されていません。アプリ内ブラウザ(TikTok・LINE等)の場合はChromeやSafariで開き直し、それ以外はブラウザの設定でマイクを許可してください。",
  "service-not-allowed": "このブラウザでは音声認識が使えません。ChromeやSafariで開き直してください。",
  "audio-capture": "マイクが見つかりません。マイクの接続や他のアプリでの使用状況を確認してください。",
  network: "音声認識サーバーに接続できません。通信状況を確認してください。",
  "language-not-supported": "このブラウザは日本語の音声認識に対応していません。",
};

/**
 * ブラウザ標準 Web Speech API を使った実装。
 * 将来 whisper.cpp(WASM) 等に差し替える場合は、この SpeechRecognizer
 * インターフェースを満たす別クラスを作って main の呼び出し元で切り替えるだけでよい。
 */
export class WebSpeechRecognizer implements SpeechRecognizer {
  private recognition: any = null;
  private finalCallback: ((text: string) => void) | null = null;
  private interimCallback: ((text: string) => void) | null = null;
  private errorCallback: ((message: string, fatal: boolean) => void) | null = null;

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
      // Android版Chrome等では resultIndex が進まず、確定済みの結果が次のイベントでも
      // 再送されることがある(→同じ発言がタイムラインに2枚並ぶ原因)。
      // resultIndex を信用せず全件を走査し、このセッションで通知済みの index は飛ばす。
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          if (this.emittedFinalIndices.has(i)) continue;
          this.emittedFinalIndices.add(i);
          this.emitFinal(transcript.trim());
        } else if (i >= event.resultIndex) {
          interim += transcript;
        }
      }
      if (interim) {
        this.interimCallback?.(interim.trim());
      }
    };

    // start()/自動再開のたびに results は0件から数え直しになるので、通知済み index もリセットする
    recognition.onstart = () => {
      this.running = true;
      this.emittedFinalIndices.clear();
    };

    recognition.onerror = (event: any) => {
      const code: string = event.error ?? "unknown";
      // 無音(no-speech)や停止操作による中断(aborted)はエラー表示しない。自動再開に任せる
      if (code === "no-speech" || code === "aborted") return;
      const fatal = FATAL_ERRORS.has(code);
      if (fatal) this.shouldRestart = false;
      this.errorCallback?.(ERROR_MESSAGES[code] ?? `音声認識でエラーが発生しました(${code})`, fatal);
    };

    // 無音等でセッションが切れた場合、録音継続中なら自動再開する
    recognition.onend = () => {
      this.running = false;
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
  private running = false;
  private emittedFinalIndices = new Set<number>();
  private lastFinalText = "";
  private lastFinalAt = 0;

  /** 自動再開の直後などに同じ文が再度確定として届いた場合も、短時間内の同一文は1回だけ通知する */
  private emitFinal(text: string): void {
    if (!text) return;
    const now = Date.now();
    if (text === this.lastFinalText && now - this.lastFinalAt < DUPLICATE_WINDOW_MS) return;
    this.lastFinalText = text;
    this.lastFinalAt = now;
    this.finalCallback?.(text);
  }

  isSupported(): boolean {
    return this.recognition !== null;
  }

  start(): void {
    if (!this.recognition) return;
    this.shouldRestart = true;
    // 認識中に二重で start() すると InvalidStateError になる/環境によっては二重に動くので呼ばない
    if (this.running) return;
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

  dispose(): void {
    if (!this.recognition) return;
    this.shouldRestart = false;
    this.finalCallback = null;
    this.interimCallback = null;
    this.errorCallback = null;
    try {
      this.recognition.abort();
    } catch {
      // 未開始なら無視
    }
  }

  onFinalResult(callback: (text: string) => void): void {
    this.finalCallback = callback;
  }

  onInterimResult(callback: (text: string) => void): void {
    this.interimCallback = callback;
  }

  onError(callback: (message: string, fatal: boolean) => void): void {
    this.errorCallback = callback;
  }
}
