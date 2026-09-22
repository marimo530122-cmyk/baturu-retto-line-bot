export interface SpeechRecognizer {
  /** 認識を開始する */
  start(): void;
  /** 認識を停止する */
  stop(): void;
  /** 発言が確定(isFinal)した瞬間に呼ばれる */
  onFinalResult(callback: (text: string) => void): void;
  /** 認識中の未確定テキスト(表示用、任意) */
  onInterimResult?(callback: (text: string) => void): void;
  onError?(callback: (message: string) => void): void;
  /** モデル読み込み中などの一時的な状態メッセージ(任意、エラーではない) */
  onStatus?(callback: (message: string) => void): void;
  isSupported(): boolean;
}
