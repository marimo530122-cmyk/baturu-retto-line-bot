"use client";

import { TextareaHTMLAttributes, useEffect, useRef } from "react";

/**
 * 入力量に合わせて自動で高さが伸びるテキストエリア。
 * 長文のSOAP所見・紹介状の要約などを、スクロールの中に押し込めず
 * その場でサクッと全体を見ながら直せるようにする。
 */
export default function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [props.value]);

  return (
    <textarea
      {...props}
      ref={ref}
      onInput={(e) => {
        resize();
        props.onInput?.(e);
      }}
      style={{ overflow: "hidden", resize: "none", ...props.style }}
    />
  );
}
