import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "🍀 로또 분석기",
  description: "확률과 통계 기반 로또 번호 추천 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#0d1117] text-[#e6edf3] antialiased">
        {children}
      </body>
    </html>
  );
}
