"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClassifiedUtterance, Mode } from "@/lib/types";
import { WebSpeechRecognizer } from "@/lib/speech/webSpeechRecognizer";
import { SpeechRecognizer } from "@/lib/speech/types";

const CONTEXT_WINDOW = 5;

export function useMeetingSession(mode: Mode = "meeting") {
  const [utterances, setUtterances] = useState<ClassifiedUtterance[]>([]);
  const [interimText, setInterimText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const utterancesRef = useRef<ClassifiedUtterance[]>([]);
  const isRecordingRef = useRef(false);

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

  // 認識器は一度だけ生成して使い回すため、コールバックは ref 経由で常に最新(=現在のモード)の関数を呼ぶ
  const classifyRef = useRef(classifyAndAppend);
  useEffect(() => {
    classifyRef.current = classifyAndAppend;
  }, [classifyAndAppend]);

  useEffect(() => {
    return () => {
      recognizerRef.current?.dispose?.();
      recognizerRef.current = null;
    };
  }, []);

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed) classifyAndAppend(trimmed);
    },
    [classifyAndAppend]
  );

  const start = useCallback(() => {
    if (isRecordingRef.current) return;
    if (!recognizerRef.current) {
      const recognizer = new WebSpeechRecognizer("ja-JP");
      if (!recognizer.isSupported()) {
        setSupported(false);
        setError("このブラウザは音声認識(Web Speech API)に対応していません。Chromeでの利用を推奨します。");
        return;
      }
      recognizer.onFinalResult((text) => {
        setInterimText("");
        if (text) classifyRef.current(text);
      });
      recognizer.onInterimResult?.((text) => setInterimText(text));
      recognizer.onError?.((message, fatal) => {
        setError(message);
        if (fatal) {
          isRecordingRef.current = false;
          setIsRecording(false);
          setInterimText("");
        }
      });
      recognizerRef.current = recognizer;
    }
    setError(null);
    recognizerRef.current.start();
    isRecordingRef.current = true;
    setIsRecording(true);
  }, []);

  const stop = useCallback(() => {
    recognizerRef.current?.stop();
    isRecordingRef.current = false;
    setIsRecording(false);
    setInterimText("");
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

  return { utterances, interimText, isRecording, error, supported, start, stop, toggleTodo, reset, submitText };
}
