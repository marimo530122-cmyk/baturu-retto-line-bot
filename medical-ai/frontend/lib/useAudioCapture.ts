"use client";

import { useCallback, useRef, useState } from "react";

/**
 * マイク音声を 16kHz mono PCM16 にダウンサンプルし、base64 チャンクとして
 * onChunk に渡すフック。バックエンドの /api/sessions/{id}/audio WebSocket へ
 * {"type":"audio_chunk","audio":"<base64>"} として送る想定。
 *
 * 注意: ブラウザの ScriptProcessorNode を使用したシンプルな実装（プロトタイプ用途）。
 * 本番では AudioWorklet への置き換えを推奨。
 */
export function useAudioCapture(onChunk: (base64Pcm16: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm16 = downsampleAndEncode(input, audioCtx.sampleRate, 16000);
        onChunk(pcm16);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      setIsRecording(true);
    } catch (e) {
      setError("マイクにアクセスできませんでした: " + String(e));
    }
  }, [onChunk]);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    setIsRecording(false);
  }, []);

  return { isRecording, error, start, stop };
}

function downsampleAndEncode(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number
): string {
  const ratio = inputSampleRate / targetSampleRate;
  const outLength = Math.floor(input.length / ratio);
  const pcm16 = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    const sample = Math.max(-1, Math.min(1, input[srcIndex]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
