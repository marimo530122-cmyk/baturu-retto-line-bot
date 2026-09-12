import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "医療AI 診察支援",
  description: "リアルタイム音声から議事録・SOAPカルテ・紹介状・処方オーダを自動生成",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <header className="bg-clinic-primary text-white px-6 py-3 shadow-sm">
          <h1 className="text-lg font-semibold tracking-wide">医療AI 診察支援システム</h1>
        </header>
        <main className="p-4 md:p-6 max-w-6xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
