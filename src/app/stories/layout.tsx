import Link from "next/link";

export const metadata = {
  title: "로또 이야기 | 로또 분석기",
  description: "로또의 역사, 당첨 확률, 당첨자 이야기, 꿈 해몽까지 — 로또에 관한 모든 이야기",
};

export default function StoriesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/dashboard/draws" className="text-gray-400 hover:text-amber-500 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <Link href="/stories" className="flex items-center gap-2">
            <span className="text-xl">🍀</span>
            <span className="font-extrabold text-[#e8a000] tracking-tight">로또 이야기</span>
          </Link>
        </div>
      </header>

      {/* 본문 */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
