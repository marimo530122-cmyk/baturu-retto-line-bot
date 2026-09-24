"use client";

import { useCallback, useRef, useState } from "react";
import { ClassifiedUtterance, Mode } from "@/lib/types";
import { WebSpeechRecognizer } from "@/lib/speech/webSpeechRecognizer";
import { WhisperRecognizer } from "@/lib/speech/whisperRecognizer";
import { SpeechRecognizer } from "@/lib/speech/types";

const CONTEXT_WINDOW = 5;

export function useMeetingSession(mode: Mode = "meeting") {
  const [utterances, setUtterances] = useState<ClassifiedUtterance[]>([]);
  const [interimText, setInterimText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const utterancesRef = useRef<ClassifiedUtterance[]>([]);

  const classifyAndAppend = useCallback(async (text: string) => {
    const recentContext = utterancesRef.current.slice(-CONTEXT_WINDOW).map((u) => u.summary || u.text);

    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context: recentContext, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分類に失敗しました");

      const entry: ClassifiedUtterance = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        category: data.category,
        summary: data.summary,
        importance: data.importance,
        timestamp: Date.now(),
      };
      utterancesRef.current = [...utterancesRef.current, entry];
      setUtterances(utterancesRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分類に失敗しました");
    }
  }, [mode]);

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed) classifyAndAppend(trimmed);
    },
    [classifyAndAppend]
  );

  // WhisperRecognizer(オンデバイスWhisper、日本語対応)を優先的に使い、モデルの起動自体に
  // 失敗した場合だけブラウザ標準の WebSpeechRecognizer に自動で切り替える。
  const attachRecognizer = useCallback(
    (recognizer: SpeechRecognizer) => {
      recognizer.onFinalResult((text) => {
        setInterimText("");
        if (text) classifyAndAppend(text);
      });
      recognizer.onInterimResult?.((text) => setInterimText(text));
      recognizer.onStatus?.((message) => setStatus(message || null));
      recognizer.onError?.((message) => {
        if (recognizer instanceof WhisperRecognizer && recognizer.hasNeverSucceeded()) {
          recognizer.stop();
          setStatus(null);

          const fallback = new WebSpeechRecognizer("ja-JP");
          if (!fallback.isSupported()) {
            setSupported(false);
            setError("音声認識を利用できませんでした。Chromeでの利用を推奨します。");
            return;
          }
          attachRecognizer(fallback);
          recognizerRef.current = fallback;
          fallback.start();
          setError("オンデバイス音声認識の起動に失敗したため、ブラウザ標準の音声認識に切り替えました。");
          return;
        }
        setError(message);
      });
    },
    [classifyAndAppend]
  );

  const start = useCallback(() => {
    if (!recognizerRef.current) {
      const whisper = new WhisperRecognizer();
      const initial: SpeechRecognizer = whisper.isSupported() ? whisper : new WebSpeechRecognizer("ja-JP");
      if (!initial.isSupported()) {
        setSupported(false);
        setError("このブラウザは音声認識に対応していません。Chromeでの利用を推奨します。");
        return;
      }
      attachRecognizer(initial);
      recognizerRef.current = initial;
    }
    setError(null);
    recognizerRef.current.start();
    setIsRecording(true);
  }, [attachRecognizer]);

  const stop = useCallback(() => {
    recognizerRef.current?.stop();
    setIsRecording(false);
    setInterimText("");
    setStatus(null);
  }, []);

  const toggleTodo = useCallback((id: string) => {
    utterancesRef.current = utterancesRef.current.map((u) => (u.id === id ? { ...u, done: !u.done } : u));
    setUtterances(utterancesRef.current);
  }, []);

  const reset = useCallback(() => {
    utterancesRef.current = [];
    setUtterances([]);
    setInterimText("");
    setError(null);
  }, []);

  return {
    utterances,
    interimText,
    isRecording,
    error,
    status,
    supported,
    start,
    stop,
    toggleTodo,
    reset,
    submitText,
  };
}
