/**
 * npm install が通らない環境向けの型スタブ。
 * 実際のパッケージ(package.json に記載済み)がインストールされていれば、
 * そちらの型が優先されてこのファイルは無視される。
 */
declare module "@huggingface/transformers" {
  export type AutomaticSpeechRecognitionPipeline = {
    (audio: Float32Array, options?: Record<string, unknown>): Promise<{ text: string } | { text: string }[]>;
  };
  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>
  ): Promise<AutomaticSpeechRecognitionPipeline>;
  export const env: Record<string, unknown>;
}

declare module "@ricky0123/vad-web" {
  type MicVADInstance = {
    start(): void;
    pause(): Promise<void> | void;
    destroy(): Promise<void> | void;
  };
  export class MicVAD {
    static new(options: Record<string, unknown>): Promise<MicVADInstance>;
  }
}
