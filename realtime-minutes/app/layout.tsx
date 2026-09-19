import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "リアルタイム議事録",
  description: "音声認識 → AI7分類 → 動的マインドマップ のリアルタイム議事録プロトタイプ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
