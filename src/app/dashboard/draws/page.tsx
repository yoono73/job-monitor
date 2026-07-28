"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getLatestStories, CATEGORY_COLORS, StoryCategory } from "@/lib/stories";

interface Draw {
  draw_no: number;
  draw_date: string;
  n1: number; n2: number; n3: number;
  n4: number; n5: number; n6: number;
  bonus: number;
  prize_1st: number;
  winners_1st: number;
}

function ballColor(n: number): string {
  if (n <= 10) return "bg-[#FBC400] text-black";
  if (n <= 20) return "bg-[#069FDD] text-white";
  if (n <= 30) return "bg-[#FF5757] text-white";
  if (n <= 40) return "bg-[#AAAAAA] text-white";
  return "bg-[#B0D840] text-black";
}

function Ball({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "w-7 h-7 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  }[size];
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${cls} ${ballColor(n)}`}>
      {n}
    </span>
  );
}

function BonusBall({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "w-7 h-7 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  }[size];
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 border-2 border-dashed border-gray-400 ${cls} ${ballColor(n)}`}>
      {n}
    </span>
  );
}

/* ─── Types for my results ─── */
interface MyResult {
  id: string;
  numbers: number[];
  method: string;
  category: string;
  matchCount: number;
  hasBonus: boolean;
  prize: string;
  purchased: boolean;
}
interface NextSaved {
  id: string;
  numbers: number[];
  method: string;
  category: string;
}

function getPrize(matchCount: number, hasBonus: boolean): string {
  if (matchCount === 6) return "1등";
  if (matchCount === 5 && hasBonus) return "2등";
  if (matchCount === 5) return "3등";
  if (matchCount === 4) return "4등";
  if (matchCount === 3) return "5등";
  return "낙첨";
}
function prizeBadgeCls(prize: string): string {
  switch (prize) {
    case "1등": return "bg-yellow-400 text-yellow-900";
    case "2등": return "bg-orange-400 text-orange-900";
    case "3등": return "bg-red-400 text-white";
    case "4등": return "bg-blue-400 text-white";
    case "5등": return "bg-emerald-500 text-white";
    default:    return "bg-gray-100 text-gray-400";
  }
}

function formatPrize(n: number) {
  if (!n) return null;
  const eok = Math.floor(n / 100000000);
  const man = Math.floor((n % 100000000) / 10000);
  if (eok > 0) return `${eok.toLocaleString()}억 ${man > 0 ? man.toLocaleString() + "만" : ""}원`;
  return `${man.toLocaleString()}만원`;
}

const PER_PAGE = 20;

export default function DrawsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [draws, setDraws]     = useState<Draw[]>([]);
  const [query, setQuery]     = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [myResults,  setMyResults]  = useState<MyResult[]>([]);
  const [nextSaved,  setNextSaved]  = useState<NextSaved[]>([]);
  const [myLoading,  setMyLoading]  = useState(false);

  const fetchDraws = useCallback(async (pageNum: number, search: string) => {
    setLoading(true);

    let q;
    if (search.match(/^\d+$/)) {
      q = supabase
        .from("lotto_draws")
        .select("draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus,prize_1st,winners_1st")
        .eq("draw_no", parseInt(search));
    } else {
      q = supabase
        .from("lotto_draws")
        .select("draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus,prize_1st,winners_1st")
        .order("draw_no", { ascending: false })
        .range(pageNum * PER_PAGE, pageNum * PER_PAGE + PER_PAGE - 1);
    }

    const { data } = await q;
    const rows = (data as Draw[]) ?? [];
    if (pageNum === 0) setDraws(rows);
    else setDraws((prev) => [...prev, ...rows]);
    setHasMore(!search && rows.length === PER_PAGE);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    setPage(0);
    fetchDraws(0, query);
  }, [query, fetchDraws]);

  const latest = !query ? draws[0] : null;
  const listDraws = !query ? draws.slice(1) : draws;

  /* ── 내 번호 결과 fetch ── */
  useEffect(() => {
    if (!latest) return;
    const draw = latest; // capture for async closure
    let cancelled = false;
    async function fetchMine() {
      setMyLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) { setMyLoading(false); return; }

      // 최신 회차 결과
      const { data: saved } = await supabase
        .from("saved_numbers")
        .select("id,numbers,method,category,purchased")
        .eq("user_id", user.id)
        .eq("draw_no", draw.draw_no);

      if (!cancelled && saved && saved.length > 0) {
        const winNums = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6];
        setMyResults((saved as { id: string; numbers: number[]; method: string; category: string; purchased: boolean }[]).map(s => {
          const nums = s.numbers as number[];
          const matchCount = nums.filter(n => winNums.includes(n)).length;
          const hasBonus = nums.includes(draw.bonus);
          const prize = getPrize(matchCount, hasBonus);
          return { id: s.id, numbers: nums, method: s.method, category: s.category,
                   matchCount, hasBonus, prize, purchased: s.purchased };
        }));
      }

      // 다음 회차 저장 번호 (아직 추첨 전)
      const { data: nextData } = await supabase
        .from("saved_numbers")
        .select("id,numbers,method,category")
        .eq("user_id", user.id)
        .eq("draw_no", draw.draw_no + 1);

      if (!cancelled && nextData) setNextSaved(nextData as NextSaved[]);
      if (!cancelled) setMyLoading(false);
    }
    fetchMine();
    return () => { cancelled = true; };
  }, [latest, supabase]);

  return (
    <div className="px-4 py-5 md:px-6 lg:px-8">

      {/* 검색 */}
      <div className="mb-5 relative max-w-sm">
        <input
          type="number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="회차 번호 검색 (예: 1150)"
          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-xl
            text-gray-800 placeholder-gray-400 text-sm shadow-sm
            focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none"
          >✕</button>
        )}
      </div>

      {/* 최신 회차 히어로 카드 */}
      {latest && (
        <div className="bg-gradient-to-r from-amber-400 to-yellow-300 rounded-2xl p-5 mb-6 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <span className="text-white font-extrabold text-lg drop-shadow">
              제 {latest.draw_no}회
            </span>
            <span className="text-xs bg-white/30 text-white font-semibold px-2 py-0.5 rounded-full">
              최신
            </span>
          </div>
          <p className="text-white/80 text-xs mb-3">{latest.draw_date}</p>

          {/* 공 — 반응형 크기 */}
          <div className="flex items-center gap-2 flex-wrap">
            {[latest.n1, latest.n2, latest.n3, latest.n4, latest.n5, latest.n6].map((n, i) => (
              <Ball key={i} n={n} size="lg" />
            ))}
            <span className="text-white/60 text-xl font-light">+</span>
            <BonusBall n={latest.bonus} size="lg" />
          </div>

          {latest.prize_1st > 0 && (
            <p className="mt-3 text-white/90 text-sm font-semibold">
              1등 {formatPrize(latest.prize_1st)} · {latest.winners_1st}명 당첨
            </p>
          )}
        </div>
      )}

      {/* ── 내 번호 결과 ── */}
      {!query && !myLoading && latest && (myResults.length > 0 || nextSaved.length > 0) && (
        <div className="mb-6">

          {/* 최신 회차 결과 */}
          {myResults.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-gray-800">🎯 {latest?.draw_no}회 내 번호 결과</span>
                  {myResults.some(r => r.prize !== "낙첨") && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">적중!</span>
                  )}
                </div>
                <Link href="/dashboard/history" className="text-xs text-amber-600 font-semibold hover:underline">
                  전체보기 →
                </Link>
              </div>
              <div className="space-y-2">
                {myResults.map((r, i) => (
                  <div key={r.id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2
                      ${r.prize === "낙첨" ? "bg-gray-50" : "bg-emerald-50 border border-emerald-200"}`}>
                    <span className="text-xs text-gray-400 w-5 shrink-0 font-bold">{i + 1}</span>
                    <div className="flex gap-1 flex-wrap flex-1">
                      {r.numbers.map((n, j) => {
                        const win = latest ? [latest.n1,latest.n2,latest.n3,latest.n4,latest.n5,latest.n6].includes(n) : false;
                        return (
                          <span key={j}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold
                              ${win ? "ring-2 ring-emerald-400 scale-110 " : "opacity-50 "}${
                              n<=10?"bg-[#FBC400] text-black":n<=20?"bg-[#069FDD] text-white":
                              n<=30?"bg-[#FF5757] text-white":n<=40?"bg-[#AAAAAA] text-white":"bg-[#B0D840] text-black"}`}>
                            {n}
                          </span>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-gray-500 font-semibold">{r.matchCount}개</span>
                      <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full ${prizeBadgeCls(r.prize)}`}>
                        {r.prize}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* 요약 */}
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-500">
                <span>{myResults.length}게임 확인</span>
                <span>·</span>
                <span className="text-emerald-600 font-bold">
                  {myResults.filter(r => r.prize !== "낙첨").length}개 적중
                </span>
                {myResults.some(r => ["1등","2등","3등"].includes(r.prize)) && (
                  <span className="text-yellow-600 font-bold ml-auto">🏆 고액 당첨 확인!</span>
                )}
              </div>
            </div>
          )}

          {/* 다음 회차 대기 */}
          {nextSaved.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-extrabold text-amber-800">⏳ {latest ? latest.draw_no + 1 : "?"}회 대기 중</p>
                  <p className="text-xs text-amber-600 mt-0.5">{nextSaved.length}게임 저장 · 토요일 추첨 후 자동 업데이트</p>
                </div>
                <Link href="/dashboard/history" className="text-xs text-amber-600 font-semibold hover:underline shrink-0">
                  확인 →
                </Link>
              </div>
            </div>
          )}

        </div>
      )}

      {/* 회차 목록 — md 이상은 2열 그리드, lg는 3열 */}
      {loading && draws.length === 0 ? (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-amber-300 border-t-amber-500 rounded-full" />
        </div>
      ) : listDraws.length === 0 && !loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">검색 결과가 없습니다</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {listDraws.map((d) => (
            <div
              key={d.draw_no}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm hover:shadow-md hover:border-amber-200 transition-all"
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-xs">
                  제 <span className="text-gray-800 font-bold text-sm">{d.draw_no}</span>회
                </span>
                <span className="text-gray-400 text-xs">{d.draw_date}</span>
              </div>

              {/* 공 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].map((n, i) => (
                  <Ball key={i} n={n} size="sm" />
                ))}
                <span className="text-gray-300 text-sm">+</span>
                <BonusBall n={d.bonus} size="sm" />
              </div>

              {/* 1등 정보 */}
              {d.prize_1st > 0 && (
                <p className="mt-2 text-[11px] text-amber-600 font-medium">
                  1등 {formatPrize(d.prize_1st)} · {d.winners_1st}명
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 더 보기 */}
      {!query && hasMore && (
        <button
          onClick={() => {
            const next = page + 1;
            setPage(next);
            fetchDraws(next, "");
          }}
          disabled={loading}
          className="w-full mt-5 py-3 text-sm font-semibold text-gray-500 hover:text-amber-600
            bg-white border border-gray-200 hover:border-amber-300 rounded-xl shadow-sm
            transition disabled:opacity-40"
        >
          {loading ? "로딩 중..." : "더 보기"}
        </button>
      )}

      {/* ── 로또 이야기 섹션 ── */}
      <StoryPreview />
    </div>
  );
}

// ──────────────────────────────────────────────────
// 로또 이야기 미리보기 카드 (서버 데이터, 클라이언트 렌더)
// ──────────────────────────────────────────────────
function StoryPreview() {
  const stories = getLatestStories(2);

  return (
    <section className="mt-10 pt-8 border-t border-gray-100">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📖</span>
          <h2 className="text-base font-extrabold text-gray-800">로또 이야기</h2>
        </div>
        <Link
          href="/stories"
          className="text-xs text-amber-500 hover:text-amber-600 font-semibold transition-colors"
        >
          전체 보기 →
        </Link>
      </div>

      {/* 카드 2개 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {stories.map((story) => (
          <Link
            key={story.slug}
            href={`/stories/${story.slug}`}
            className="group block bg-white border border-gray-200 rounded-xl p-4
              hover:border-amber-300 hover:shadow-sm transition-all duration-200"
          >
            <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2
              ${CATEGORY_COLORS[story.category as StoryCategory]}`}>
              {story.categoryLabel}
            </span>
            <p className="text-sm font-bold text-gray-800 group-hover:text-amber-600
              transition-colors leading-snug line-clamp-2">
              {story.title}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
