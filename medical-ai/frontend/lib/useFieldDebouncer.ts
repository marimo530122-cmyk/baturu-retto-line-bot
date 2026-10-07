"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * フィールド単位でデバウンス保存するための汎用フック。
 *
 * 画面上の表示(ローカルstate)は入力のたびに即座に更新する一方、実際の保存API呼び出しは
 * 入力が止まってから一定時間後にまとめて1回だけ行うことで、「1文字打つたびにAPIを叩いて
 * もっさりする」問題を避けつつ、blur(フォーカスを外した瞬間)には即座に保存を確定させる。
 */
export function useFieldDebouncer(delayMs = 700) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const current = timers.current;
    return () => {
      current.forEach((t) => clearTimeout(t));
      current.clear();
    };
  }, []);

  const schedule = useCallback(
    (key: string, fn: () => void) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.current.delete(key);
        fn();
      }, delayMs);
      timers.current.set(key, timer);
    },
    [delayMs]
  );

  const flush = useCallback((key: string, fn: () => void) => {
    const existing = timers.current.get(key);
    if (existing) {
      clearTimeout(existing);
      timers.current.delete(key);
    }
    fn();
  }, []);

  return { schedule, flush };
}
