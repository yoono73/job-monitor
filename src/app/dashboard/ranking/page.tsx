"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// public_draw_stats 뷰 행 타입
interface DrawStat {
  draw_no: number;
  draw_date: string | null;
  n1: number | null; n2: number | null; n3: number | null;
  n4: number | null; n5: number | null; n6: number | null;
  bonus: number | null;
  total_entries: number;
  rank1_count: number;
  rank2_count: number;
  rank3_count: number;
  rank4_count: number;
  rank5_count: number;
  total_winners: number;
  winner_strategies: string[] | null;
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

// ── 전략 태그 파싱 (method:category 형태) ──
function StrategyBadge({ raw }: { raw: string }) {
  const [method, category] = raw.split(":");
  return (
    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700
      text-[11px] font-semibold px-2 py-0.5 rounded-full">
      {method}{category ? ` · ${category}` : ""}
    </span>
  );
}

// ── 회차 카드 ──
function DrawCard({ stat }: { stat: DrawStat }) {
  const hasWinner = stat.total_winners > 0;
  const winNums = [stat.n1, stat.n2, stat.n3, stat.n4, stat.n5, stat.n6].filter(Boolean) as number[];

  return (
    <div className={`bg-white border rounded-2xl p-5 transition-all
      ${hasWinner
        ? "border-amber-300 shadow-[0_0_0_2px_rgba(232,160,0,0.15)]"
        : "border-gray-200"}`}>

      {/* 헤더 행 */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-lg font-extrabold text-gray-900">제 {stat.draw_no}회</span>
          {stat.draw_date && (
            <span className="ml-2 text-xs text-gray-400">
              {stat.draw_date.slice(0, 10)}
            </span>
          )}
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full
          ${hasWinner
            ? "bg-amber-100 text-amber-700"
            : "bg-gray-100 text-gray-400"}`}>
          {stat.total_entries}게임 참여
        </span>
      </div>

      {/* 당첨 번호 */}
      {winNums.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {winNums.map((n, i) => <Ball key={i} n={n} size="sm" />)}
          {stat.bonus != null && (
            <>
              <span className="text-gray-300 text-sm">+</span>
              <span className="w-7 h-7 rounded-full border-2 border-gray-300 text-xs font-extrabold
                text-gray-400 flex items-center justify-center">{stat.bonus}</span>
            </>
          )}
        </div>
      )}

      {/* 등수별 인원 */}
      <div className="grid grid-cols-5 gap-1 mb-3">
        {([1,2,3,4,5] as const).map((rank) => {
          const count = stat[`rank${rank}_count` as keyof DrawStat] as number;
          return (
            <div key={rank} className={`text-center p-2 rounded-lg
              ${count > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
              <p className="text-[10px] text-gray-400 font-medium">{rank}등</p>
              <p className={`text-sm font-extrabold
                ${count > 0 ? "text-amber-600" : "text-gray-300"}`}>
                {count}명
              </p>
            </div>
          );
        })}
      </div>

      {/* 당첨 전략 */}
      {hasWinner && stat.winner_strategies && stat.winner_strategies.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-100">
          <p className="text-[11px] text-gray-400 mb-1.5">당첨 전략</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.winner_strategies.map((s, i) => (
              <StrategyBadge key={i} raw={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 빈 상태 ──
function EmptyState() {
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
  const [stats, setStats] = useState<DrawStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("public_draw_stats")
      .select("*")
      .order("draw_no", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) {
          setError("데이터를 불러오지 못했습니다.");
        } else {
          setStats((data as DrawStat[]) ?? []);
        }
        setLoading(false);
      });
  }, []);

  return (
    <div className="px-4 py-6 max-w-xl mx-auto">
      {/* 타이틀 */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-gray-900">🎉 당첨현황</h1>
        <p className="text-xs text-gray-400 mt-1">
          회원들의 익명 당첨 기록 — 누가 됐는지는 표시되지 않습니다
        </p>
      </div>

      {/* 상태별 렌더링 */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-amber-300 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
          {error}
          <p className="text-xs text-gray-400 mt-1">
            ※ public_draw_stats 뷰가 생성되지 않았거나 권한이 없을 수 있습니다.
          </p>
        </div>
      )}

      {!loading && !error && stats.length === 0 && <EmptyState />}

      {!loading && !error && stats.length > 0 && (
        <div className="space-y-4">
          {stats.map((stat) => (
            <DrawCard key={stat.draw_no} stat={stat} />
          ))}
        </div>
      )}
    </div>
  );
}
