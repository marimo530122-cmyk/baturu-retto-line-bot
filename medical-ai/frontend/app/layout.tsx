import type { Metadata } from "next";
import "./globals.css";
import MonitoringInit from "@/components/MonitoringInit";
import AuthShell from "@/components/AuthShell";

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
        <MonitoringInit />
        <AuthShell>{children}</AuthShell>
      </body>
    </html>
  );
}
