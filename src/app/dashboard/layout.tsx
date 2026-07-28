"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ── 하단 탭 4개 (자주 쓰는 핵심 메뉴) ──
const MAIN_NAV = [
  { href: "/dashboard/draws",    label: "당첨번호", icon: "🏆" },
  { href: "/dashboard/ranking",  label: "현황",     icon: "🎉" },
  { href: "/dashboard/stats",    label: "통계",     icon: "📊" },
  { href: "/dashboard/generate", label: "생성",     icon: "🎰" },
];

// ── 헤더 우측 아이콘 2개 (덜 쓰는 메뉴) ──
const SUB_NAV = [
  { href: "/dashboard/history", label: "기록",   icon: "📋" },
  { href: "/dashboard/profile", label: "내정보", icon: "👤" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ── 상단 헤더 ── */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto w-full">

          {/* 로고 행 — 모든 해상도에서 공통 */}
          <div className="flex items-center justify-between px-4 md:px-6">

            {/* 로고 */}
            <div className="flex items-center gap-2 py-3">
              <span className="text-2xl">🍀</span>
              <span className="text-lg font-extrabold text-[#e8a000] tracking-tight">
                로또 분석기
              </span>
            </div>

            {/* 오른쪽 영역 */}
            <div className="flex items-center gap-1">

              {/* md 이상: 모든 탭 인라인 */}
              <nav className="hidden md:flex items-center gap-1">
                {[...MAIN_NAV, ...SUB_NAV].map((item) => {
                  const active = path.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`
                        relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold
                        transition-all duration-150
                        ${active
                          ? "text-[#e8a000] bg-amber-50"
                          : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                        }
                      `}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span>{item.label}</span>
                      {active && (
                        <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#e8a000] rounded-full" />
                      )}
                    </Link>
                  );
                })}
              </nav>

              {/* 모바일: 서브 아이콘 2개 (기록·내정보) */}
              <div className="flex md:hidden items-center gap-0.5">
                {SUB_NAV.map((item) => {
                  const active = path.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className={`
                        flex flex-col items-center justify-center w-10 h-10 rounded-lg
                        transition-all duration-150
                        ${active
                          ? "text-[#e8a000] bg-amber-50"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        }
                      `}
                    >
                      <span className="text-lg leading-none">{item.icon}</span>
                    </Link>
                  );
                })}
              </div>

            </div>
          </div>

          {/* 모바일 전용: 하단 탭바 (메인 4개) */}
          <div className="flex md:hidden border-t border-gray-100">
            {MAIN_NAV.map((item) => {
              const active = path.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    relative flex-1 flex flex-col items-center justify-center
                    py-2 gap-0.5 text-center transition-all duration-150
                    ${active
                      ? "text-[#e8a000] bg-amber-50"
                      : "text-gray-400 hover:text-gray-600"
                    }
                  `}
                >
                  <span className="text-xl leading-none">{item.icon}</span>
                  <span className="text-[10px] font-semibold">{item.label}</span>
                  {active && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#e8a000] rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>

        </div>
      </header>

      {/* 본문 */}
      <main className="flex-1 bg-gray-50">
        <div className="max-w-5xl mx-auto w-full">
          {children}
        </div>
      </main>

    </div>
  );
}
