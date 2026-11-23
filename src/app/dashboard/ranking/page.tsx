"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

interface DrawRow {
  draw_no: number;
  draw_date: string | null;
  n1: number; n2: number; n3: number; n4: number; n5: number; n6: number;
  bonus: number;
}

interface SavedWinner {
  id: number;
  draw_no: number;
  numbers: number[];
  method: string | null;
  category: string | null;
  is_test: boolean;
  matched_count: number | null;
  prize_rank: number | null;
  checked_draw_no: number;
}

interface TestWinner {
  id: number;
  draw_no: number;
  numbers: number[];
  method: string | null;
  category: string | null;
  is_test?: boolean;
  matched_count: number | null;
  prize_rank: number | null;
  checked_draw_no: number;
}

// ── 볼 컴포넌트 ──
function Ball({ n, size = "sm" }: { n: number; size?: "sm" | "xs" }) {
  const color =
    n <= 10 ? "bg-[#FBC400] text-black" :
    n <= 20 ? "bg-[#069FDD] text-white" :
    n <= 30 ? "bg-[#FF5757] text-white" :
    n <= 40 ? "bg-[#AAAAAA] text-white" :
              "bg-[#B0D840] text-black";
  const cls = size === "sm"
    ? "w-7 h-7 text-xs font-extrabold"
    : "w-5 h-5 text-[10px] font-bold";
  return (
    <span className={`${color} ${cls} rounded-full flex items-center justify-center`}>{n}</span>
  );
}

// ── 등수 뱃지 ──
function RankBadge({ rank, matched }: { rank: number | null; matched: number | null }) {
  if (rank === 1) return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-yellow-400 text-yellow-900">1등</span>;
  if (rank === 2) return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-orange-400 text-white">2등</span>;
  if (rank === 3) return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">3등</span>;
  if (rank === 4) return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">4등</span>;
  if (rank === 5) return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-gray-400 text-white">5등</span>;
  if (matched !== null && matched >= 3) return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-400 text-white">{matched}개</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">-</span>;
}

// ── 등수별 집계 그리드 ──
function RankGrid({
  winners,
  accentText,
  accentBg,
}: {
  winners: SavedWinner[];
  accentText: string;
  accentBg: string;
}) {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  winners.forEach(w => {
    if (w.prize_rank !== null && w.prize_rank >= 1 && w.prize_rank <= 5) {
      counts[w.prize_rank]++;
    }
  });
  return (
    <div className="grid grid-cols-5 gap-1">
      {([1, 2, 3, 4, 5] as const).map(rank => {
        const cnt = counts[rank];
        return (
          <div key={rank} className={`text-center p-2 rounded-lg ${cnt > 0 ? accentBg : "bg-gray-50"}`}>
            <p className="text-[9px] text-gray-400 font-medium">{rank}등</p>
            <p className={`text-sm font-extrabold ${cnt > 0 ? accentText : "text-gray-300"}`}>{cnt}명</p>
          </div>
        );
      })}
    </div>
  );
}

// ── 당첨 세부 목록 ──
function WinnerList({ winners }: { winners: SavedWinner[] }) {
  if (winners.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-2">
      {winners.map(w => {
        const strat = w.method ?? w.category ?? "기타";
        const nums = Array.isArray(w.numbers) ? (w.numbers as number[]) : [];
        const hasNums = nums.length === 6 && nums.some(n => n > 0);
        return (
          <div key={w.id} className="flex items-center gap-1.5 flex-wrap">
            <RankBadge rank={w.prize_rank} matched={w.matched_count} />
            {hasNums
              ? nums.map((n, i) => <Ball key={i} n={n} size="xs" />)
              : <span className="text-[10px] text-gray-400 italic">번호미기록</span>}
            <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">
              {strat}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 회차 카드 ──
function DrawCard({
  draw,
  realWinners,
  testWinners,
}: {
  draw: DrawRow;
  realWinners: SavedWinner[];
  testWinners: TestWinner[];
}) {
  const winNums = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6].filter(Boolean) as number[];
  const hasAny = realWinners.length > 0 || testWinners.length > 0;

  return (
    <div className={`bg-white border rounded-2xl p-4 transition-all ${hasAny ? "border-amber-300 shadow-[0_0_0_2px_rgba(232,160,0,0.12)]" : "border-gray-200"}`}>

      {/* 헤더 */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-base font-extrabold text-gray-900">제 {draw.draw_no}회</span>
          {draw.draw_date && (
            <span className="ml-2 text-xs text-gray-400">{draw.draw_date.slice(0, 10)}</span>
          )}
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${hasAny ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-400"}`}>
          {hasAny ? `당첨 ${realWinners.length + testWinners.length}건` : "당첨 없음"}
        </span>
      </div>

      {/* 당첨 번호 */}
      {winNums.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {winNums.map((n, i) => <Ball key={i} n={n} size="sm" />)}
          {draw.bonus > 0 && (
            <>
              <span className="text-gray-300 text-sm">+</span>
              <span className="w-7 h-7 rounded-full border-2 border-gray-300 text-xs font-extrabold text-gray-400 flex items-center justify-center">{draw.bonus}</span>
            </>
          )}
        </div>
      )}

      {/* 당첨 없을 때 */}
      {!hasAny && (
        <p className="text-xs text-gray-300 text-center py-2">이 회차엔 3개 이상 일치한 번호가 없습니다</p>
      )}

      {/* ── 사용자 기반 ── */}
      {realWinners.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-sm">👤</span>
            <span className="text-xs font-extrabold text-indigo-800">사용자 기반</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-200 text-indigo-800 ml-auto">
              {realWinners.length}건 당첨
            </span>
          </div>
          <RankGrid winners={realWinners} accentText="text-indigo-700" accentBg="bg-indigo-100" />
          <WinnerList winners={realWinners} />
        </div>
      )}

      {/* ── 테스트 기반 ── */}
      {testWinners.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-sm">🧪</span>
            <span className="text-xs font-extrabold text-purple-800">테스트 기반</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-200 text-purple-800 ml-auto">
              {testWinners.length}건 당첨
            </span>
          </div>
          <RankGrid winners={testWinners as SavedWinner[]} accentText="text-purple-700" accentBg="bg-purple-100" />
          <WinnerList winners={testWinners as SavedWinner[]} />
        </div>
      )}
    </div>
  );
}

// ── 빈 상태 ──
function EmptyState({ loggedIn }: { loggedIn: boolean | null }) {
  if (loggedIn === false) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <span className="text-5xl mb-4">🔒</span>
        <p className="text-gray-700 font-semibold text-lg mb-2">로그인이 필요합니다</p>
        <p className="text-gray-400 text-sm">로그인하면 내 번호의 당첨 현황을 볼 수 있어요.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="text-5xl mb-4">🍀</span>
      <p className="text-gray-700 font-semibold text-lg mb-2">아직 기록이 없어요</p>
      <p className="text-gray-400 text-sm leading-relaxed">
        번호를 저장하고 추첨일을 기다려보세요.<br />
        이 화면에 결과가 쌓이기 시작합니다.
      </p>
    </div>
  );
}

// ── 메인 페이지 ──
export default function RankingPage() {
  const supabase = useMemo(() => createClient(), []);
  const [draws, setDraws] = useState<DrawRow[]>([]);
  const [winners, setWinners] = useState<SavedWinner[]>([]);
  const [testWinners, setTestWinners] = useState<TestWinner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // 로그인 확인
      const { data: { user } } = await supabase.auth.getUser();
      setLoggedIn(!!user);
      if (!user) { setLoading(false); return; }

      // ① saved_numbers: 실 사용자 번호 (is_test=false)
      const { data: savedData } = await supabase
        .from("saved_numbers")
        .select("id,draw_no,numbers,method,category,is_test,matched_count,prize_rank,checked_draw_no")
        .eq("is_test", false)
        .not("checked_draw_no", "is", null)
        .or("matched_count.gte.3,prize_rank.not.is.null")
        .order("checked_draw_no", { ascending: false });

      const winRows = (savedData ?? []) as SavedWinner[];
      setWinners(winRows);

      // ② test_simulations: 테스트 기반 번호 (당첨자 필터, 로그인 유저 것만)
      const { data: testData } = await supabase
        .from("test_simulations")
        .select("id,draw_no,numbers,method,category,matched_count,prize_rank,checked_draw_no")
        .eq("user_id", user.id)
        .not("checked_draw_no", "is", null)
        .or("matched_count.gte.3,prize_rank.not.is.null")
        .order("checked_draw_no", { ascending: false });

      const testRows = (testData ?? []) as TestWinner[];
      setTestWinners(testRows);

      // ③ 관련 회차 번호 조회 (draw_no 중복 제거) — 사용자+테스트 모두 포함
      const drawNos = [...new Set(winRows.map(w => w.checked_draw_no))];
      const testDrawNos = [...new Set(testRows.map(w => w.checked_draw_no).filter(Boolean) as number[])];

      // 체크된 당첨번호 없어도 최신 체크 회차는 보여줄 것
      const { data: allChecked } = await supabase
        .from("saved_numbers")
        .select("checked_draw_no")
        .eq("is_test", false)
        .not("checked_draw_no", "is", null);

      const allCheckedNos = [...new Set((allChecked ?? []).map((r: { checked_draw_no: number }) => r.checked_draw_no))];
      const mergedNos = [...new Set([...drawNos, ...testDrawNos, ...allCheckedNos])].sort((a, b) => b - a).slice(0, 10);

      if (mergedNos.length > 0) {
        const { data: drawData } = await supabase
          .from("lotto_draws")
          .select("draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus")
          .in("draw_no", mergedNos)
          .order("draw_no", { ascending: false });
        setDraws((drawData ?? []) as DrawRow[]);
      }

      setLoading(false);
    };
    load();
  }, [supabase]);

  // draw별 사용자/테스트 분리
  const drawResults = useMemo(() => {
    return draws.map(draw => ({
      draw,
      realWinners: winners.filter(w => w.checked_draw_no === draw.draw_no),
      testWinners: testWinners.filter(w => w.checked_draw_no === draw.draw_no),
    }));
  }, [draws, winners, testWinners]);

  return (
    <div className="px-4 py-6 max-w-xl mx-auto">
      {/* 타이틀 */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-gray-900">🎉 당첨현황</h1>
        <p className="text-xs text-gray-400 mt-1">
          내 번호의 회차별 당첨 결과 — 사용자기반 · 테스트기반 분리
        </p>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-amber-300 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 미로그인 or 빈 상태 */}
      {!loading && (draws.length === 0) && (
        <EmptyState loggedIn={loggedIn} />
      )}

      {/* 회차 카드 목록 */}
      {!loading && drawResults.length > 0 && (
        <div className="space-y-4">
          {drawResults.map(({ draw, realWinners, testWinners }) => (
            <DrawCard
              key={draw.draw_no}
              draw={draw}
              realWinners={realWinners}
              testWinners={testWinners}
            />
          ))}
        </div>
      )}
    </div>
  );
}
