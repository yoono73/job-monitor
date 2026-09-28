"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/* ─── Types ─── */
interface SavedRow {
  id: string;
  draw_no: number;
  numbers: number[];
  method: string;
  category: string;
  set_idx: number;
  created_at: string;
  purchased: boolean;
}
interface DrawRow {
  draw_no: number;
  n1: number; n2: number; n3: number;
  n4: number; n5: number; n6: number;
  bonus: number;
  draw_date: string | null;
}
interface HistoryItem {
  saved: SavedRow;
  draw: DrawRow | null;
  matchCount: number;
  hasBonus: boolean;
  prize: string;
  prizeAmount: number; // 0=미확인/꽝, 5000=5등, 50000=4등
}

/* ─── Prize 판정 ─── */
function getPrize(matchCount: number, hasBonus: boolean): string {
  if (matchCount === 6) return "1등";
  if (matchCount === 5 && hasBonus) return "2등";
  if (matchCount === 5) return "3등";
  if (matchCount === 4) return "4등";
  if (matchCount === 3) return "5등";
  return "낙첨";
}

function getPrizeAmount(prize: string): number {
  if (prize === "5등") return 5000;
  if (prize === "4등") return 50000;
  return 0; // 1~3등은 변동, 꽝/대기중은 0
}

function prizeBadge(prize: string): string {
  switch (prize) {
    case "1등": return "bg-yellow-400 text-yellow-900";
    case "2등": return "bg-orange-400 text-orange-900";
    case "3등": return "bg-red-400 text-white";
    case "4등": return "bg-blue-400 text-white";
    case "5등": return "bg-emerald-400 text-white";
    default:    return "bg-gray-100 text-gray-400";
  }
}

/* ─── Ball ─── */
function ballColor(n: number) {
  if (n <= 10) return "bg-[#FBC400] text-black";
  if (n <= 20) return "bg-[#069FDD] text-white";
  if (n <= 30) return "bg-[#FF5757] text-white";
  if (n <= 40) return "bg-[#AAAAAA] text-white";
  return "bg-[#B0D840] text-black";
}
function Ball({ n, highlight }: { n: number; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs shrink-0
      ${ballColor(n)}
      ${highlight ? "ring-2 ring-offset-1 ring-emerald-500 scale-110" : "opacity-60"}`}>
      {n}
    </span>
  );
}

/* ─── Category color ─── */
const CAT_COLOR: Record<string, string> = {
  "개인화":   "bg-yellow-100 text-yellow-700",
  "통계기반": "bg-emerald-100 text-emerald-700",
  "패턴기반": "bg-amber-100 text-amber-700",
  "균형기반": "bg-gray-100 text-gray-600",
  "베이지안": "bg-violet-100 text-violet-700",
};

/* ─── Page ─── */
export default function HistoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items,   setItems]   = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<"all" | "pending" | "bought" | "hit">("all");
  const [toggling, setToggling] = useState<string | null>(null);
  const [showStrategy, setShowStrategy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: saved } = await supabase
        .from("saved_numbers")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (!saved || saved.length === 0) { setLoading(false); return; }

      const drawNos = [...new Set((saved as SavedRow[]).map(s => s.draw_no))];
      const { data: draws } = await supabase
        .from("lotto_draws")
        .select("draw_no,n1,n2,n3,n4,n5,n6,bonus,draw_date")
        .in("draw_no", drawNos);

      const drawMap = new Map<number, DrawRow>();
      (draws as DrawRow[] ?? []).forEach(d => drawMap.set(d.draw_no, d));

      const result: HistoryItem[] = (saved as SavedRow[]).map(s => {
        const draw = drawMap.get(s.draw_no) ?? null;
        if (!draw) {
          return { saved: s, draw: null, matchCount: 0, hasBonus: false, prize: "대기중", prizeAmount: 0 };
        }
        const winNums = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6];
        const matchCount = s.numbers.filter(n => winNums.includes(n)).length;
        const hasBonus = s.numbers.includes(draw.bonus);
        const prize = getPrize(matchCount, hasBonus);
        return { saved: s, draw, matchCount, hasBonus, prize, prizeAmount: getPrizeAmount(prize) };
      });

      setItems(result);
      setLoading(false);
    }
    load();
  }, [supabase]);

  /* ── 구매완료 토글 ── */
  const togglePurchased = useCallback(async (item: HistoryItem) => {
    const id = item.saved.id;
    if (toggling === id) return;
    setToggling(id);
    const newVal = !item.saved.purchased;
    const { error } = await supabase
      .from("saved_numbers")
      .update({ purchased: newVal })
      .eq("id", id);
    if (!error) {
      setItems(prev => prev.map(it =>
        it.saved.id === id
          ? { ...it, saved: { ...it.saved, purchased: newVal } }
          : it
      ));
    }
    setToggling(null);
  }, [supabase, toggling]);

  /* ── 전략별 성과 ── */
  const strategyStats = useMemo(() => {
    const completed = items.filter(it => it.draw !== null);
    if (completed.length === 0) return [];
    const byMethod: Record<string, { count: number; matches: number[]; wins: number; category: string }> = {};
    completed.forEach(it => {
      const m = it.saved.method;
      if (!byMethod[m]) byMethod[m] = { count: 0, matches: [], wins: 0, category: it.saved.category };
      byMethod[m].count++;
      byMethod[m].matches.push(it.matchCount);
      if (it.matchCount >= 3) byMethod[m].wins++;
    });
    return Object.entries(byMethod)
      .map(([method, d]) => ({
        method,
        category: d.category,
        count: d.count,
        avgMatch: +(d.matches.reduce((a, b) => a + b, 0) / d.matches.length).toFixed(2),
        bestMatch: Math.max(...d.matches),
        winRate: +(d.wins / d.count * 100).toFixed(0),
        wins: d.wins,
      }))
      .sort((a, b) => b.avgMatch - a.avgMatch || b.bestMatch - a.bestMatch);
  }, [items]);

  /* ── 집계 ── */
  const stats = useMemo(() => {
    const bought      = items.filter(it => it.saved.purchased);
    const totalInvest = bought.length * 1000;
    const totalReturn = bought.reduce((s, it) => s + it.prizeAmount, 0);
    const highPrize   = bought.filter(it => ["1등","2등","3등"].includes(it.prize));
    const pendingCount = items.filter(it => it.draw === null).length;
    const hitCount     = items.filter(it => it.matchCount >= 3).length;
    const boughtCount  = bought.length;
    return { totalInvest, totalReturn, highPrize, pendingCount, hitCount, boughtCount };
  }, [items]);

  /* ── 필터 ── */
  const filtered = items.filter(it => {
    if (filter === "pending") return it.draw === null;
    if (filter === "bought")  return it.saved.purchased;
    if (filter === "hit")     return it.matchCount >= 3;
    return true;
  });

  /* ── Render ── */
  return (
    <div className="px-4 py-5 md:px-6 lg:px-8 max-w-2xl mx-auto">

      {/* 헤더 */}
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-gray-800">📋 구매 기록</h1>
        <p className="text-sm text-gray-400 mt-1">저장한 번호 · 구매 체크 · 당첨 결과</p>
      </div>

      {/* 요약 카드 */}
      {!loading && items.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-3 text-center">
              <p className="text-2xl font-extrabold text-gray-800">{items.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">총 저장</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-3 text-center">
              <p className="text-2xl font-extrabold text-amber-500">{stats.pendingCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">결과 대기</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-3 text-center">
              <p className="text-2xl font-extrabold text-emerald-500">{stats.hitCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">3개+ 맞춤</p>
            </div>
          </div>

          {/* 투자/수익 카드 (구매완료 있을 때만) */}
          {stats.boughtCount > 0 && (
            <div className="bg-gradient-to-r from-slate-700 to-slate-600 rounded-2xl p-4 mb-4 text-white">
              <p className="text-xs text-white/60 mb-2 font-semibold">💰 구매 현황 ({stats.boughtCount}장)</p>
              <div className="flex items-center justify-between">
                <div className="text-center">
                  <p className="text-[11px] text-white/50 mb-0.5">총 투자</p>
                  <p className="text-lg font-extrabold">₩{stats.totalInvest.toLocaleString()}</p>
                </div>
                <div className="text-white/30 text-xl font-thin">→</div>
                <div className="text-center">
                  <p className="text-[11px] text-white/50 mb-0.5">확정 수익</p>
                  <p className={`text-lg font-extrabold ${stats.totalReturn > 0 ? "text-emerald-300" : "text-white/60"}`}>
                    {stats.totalReturn > 0 ? `₩${stats.totalReturn.toLocaleString()}` : "-"}
                  </p>
                </div>
                <div className="text-white/30 text-xl font-thin">=</div>
                <div className="text-center">
                  <p className="text-[11px] text-white/50 mb-0.5">손익</p>
                  <p className={`text-lg font-extrabold ${
                    stats.totalReturn - stats.totalInvest > 0 ? "text-emerald-300" :
                    stats.totalReturn - stats.totalInvest === 0 ? "text-white/60" : "text-rose-300"
                  }`}>
                    {stats.totalReturn - stats.totalInvest >= 0 ? "+" : ""}
                    ₩{(stats.totalReturn - stats.totalInvest).toLocaleString()}
                  </p>
                </div>
              </div>
              {stats.highPrize.length > 0 && (
                <p className="text-xs text-yellow-300 mt-2 font-semibold">
                  🏆 {stats.highPrize.map(it => `${it.saved.draw_no}회 ${it.prize}`).join(" · ")} — 당첨금 확인 필요!
                </p>
              )}
              <p className="text-[10px] text-white/30 mt-1">※ 4등(₩50,000)·5등(₩5,000) 자동 집계 / 1~3등은 별도 확인</p>
            </div>
          )}
        </>
      )}

      {/* ── 전략 분석 패널 ── */}
      {!loading && strategyStats.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowStrategy(v => !v)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border text-sm font-bold transition
              ${showStrategy
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-white text-gray-600 border-gray-200 hover:border-slate-400"}`}>
            <span>📊 전략별 성과 분석</span>
            <span className="text-xs font-normal opacity-70">
              {showStrategy ? "접기 ▲" : `${strategyStats.length}개 전략 · 클릭해서 보기 ▼`}
            </span>
          </button>

          {showStrategy && (
            <div className="mt-2 bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              {/* 상단 요약 */}
              <div className="px-4 py-3 bg-slate-50 border-b border-gray-100">
                <p className="text-xs text-gray-500">
                  추첨 완료된 <strong className="text-gray-800">{items.filter(it => it.draw !== null).length}게임</strong> 기준
                  {strategyStats[0] && (
                    <span className="ml-2 text-amber-600 font-bold">
                      🏆 최고: {strategyStats[0].method} (평균 {strategyStats[0].avgMatch}개)
                    </span>
                  )}
                </p>
              </div>

              {/* 전략 리스트 */}
              <div className="divide-y divide-gray-50">
                {strategyStats.map((s, rank) => {
                  const barPct = Math.round((s.avgMatch / 6) * 100);
                  const catCls = CAT_COLOR[s.category] ?? "bg-gray-100 text-gray-500";
                  return (
                    <div key={s.method} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[10px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center shrink-0
                          ${rank === 0 ? "bg-yellow-400 text-yellow-900" :
                            rank === 1 ? "bg-gray-300 text-gray-700" :
                            rank === 2 ? "bg-amber-700 text-white" : "bg-gray-100 text-gray-400"}`}>
                          {rank + 1}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${catCls}`}>
                          {s.category}
                        </span>
                        <span className="text-sm font-bold text-gray-800 flex-1">{s.method}</span>
                        <span className="text-xs text-gray-400 shrink-0">{s.count}회 사용</span>
                      </div>

                      {/* 평균 일치 바 */}
                      <div className="flex items-center gap-3 mb-1.5">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              rank === 0 ? "bg-amber-400" : rank === 1 ? "bg-slate-400" : "bg-slate-200"}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="text-sm font-extrabold text-gray-800 w-12 text-right shrink-0">
                          평균 {s.avgMatch}개
                        </span>
                      </div>

                      {/* 세부 통계 */}
                      <div className="flex gap-4 text-xs text-gray-400">
                        <span>최고 <strong className="text-gray-600">{s.bestMatch}개</strong></span>
                        <span>3개+ <strong className={s.wins > 0 ? "text-emerald-600" : "text-gray-400"}>{s.wins}회 ({s.winRate}%)</strong></span>
                        {s.bestMatch >= 5 && <span className="text-yellow-500 font-bold">⭐ 고적중 기록!</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 하단 안내 */}
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-[11px] text-gray-400 text-center">
                  게임이 쌓일수록 신뢰도 올라감 · 현재 {items.filter(it=>it.draw!==null).length}게임 분석 완료
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 필터 탭 */}
      {!loading && items.length > 0 && (
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
          {([
            { key: "all",     label: `전체 ${items.length}` },
            { key: "bought",  label: `구매완료 ${stats.boughtCount}` },
            { key: "pending", label: `대기중 ${stats.pendingCount}` },
            { key: "hit",     label: `적중 ${stats.hitCount}` },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0
                ${filter === key ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-3xl mb-3 animate-pulse">⏳</div>
          <p className="text-sm">불러오는 중...</p>
        </div>
      )}

      {/* 비어있음 */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🎲</div>
          <p className="text-sm font-semibold text-gray-500">저장된 번호가 없어요</p>
          <p className="text-xs mt-1">번호 생성 후 저장 버튼을 눌러주세요</p>
        </div>
      )}

      {/* 목록 */}
      <div className="space-y-3">
        {filtered.map(it => {
          const winNums = it.draw
            ? [it.draw.n1, it.draw.n2, it.draw.n3, it.draw.n4, it.draw.n5, it.draw.n6]
            : [];
          const isPending  = it.draw === null;
          const prize      = it.prize;
          const isBought   = it.saved.purchased;
          const isToggling = toggling === it.saved.id;

          return (
            <div key={it.saved.id}
              className={`bg-white border rounded-2xl p-4 shadow-sm transition-all
                ${prize === "1등" ? "border-yellow-400 bg-yellow-50/30" :
                  prize === "2등" ? "border-orange-300 bg-orange-50/20" :
                  prize === "3등" ? "border-red-300 bg-red-50/20" :
                  isBought ? "border-slate-300 bg-slate-50/30" :
                  isPending ? "border-amber-200 bg-amber-50/10" :
                  "border-gray-100"}`}>

              {/* 상단: 회차 + 방식 + 등수 + 구매완료 버튼 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-extrabold text-gray-800 text-sm shrink-0">{it.saved.draw_no}회</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${CAT_COLOR[it.saved.category] ?? "bg-gray-100 text-gray-500"}`}>
                    {it.saved.category}
                  </span>
                  <span className="text-xs text-gray-400 truncate">{it.saved.method}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {/* 구매완료 토글 */}
                  <button
                    onClick={() => togglePurchased(it)}
                    disabled={isToggling}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition
                      ${isBought
                        ? "bg-slate-700 text-white border-slate-700"
                        : "text-gray-400 border-gray-200 hover:text-slate-600 hover:border-slate-400"}`}
                  >
                    {isToggling ? "..." : isBought ? "✓ 구매완료" : "구매완료"}
                  </button>
                  {/* 등수 배지 */}
                  <span className={`text-xs font-extrabold px-2.5 py-1 rounded-full
                    ${isPending ? "bg-amber-100 text-amber-600" : prizeBadge(prize)}`}>
                    {isPending ? "대기" : prize}
                  </span>
                </div>
              </div>

              {/* 내 번호 */}
              <div className="mb-2">
                <p className="text-[10px] text-gray-400 mb-1.5">내 번호</p>
                <div className="flex gap-1 flex-wrap">
                  {it.saved.numbers.map((n, i) => (
                    <Ball key={i} n={n} highlight={!isPending && winNums.includes(n)} />
                  ))}
                </div>
              </div>

              {/* 당첨 번호 */}
              {it.draw && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 mb-1.5">
                    당첨번호
                    {it.draw.draw_date && (
                      <span className="ml-2 text-gray-300">{it.draw.draw_date}</span>
                    )}
                  </p>
                  <div className="flex gap-1 flex-wrap items-center">
                    {winNums.map((n, i) => (
                      <Ball key={i} n={n} highlight={it.saved.numbers.includes(n)} />
                    ))}
                    <span className="text-gray-300 text-xs mx-1">+</span>
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs
                      ${ballColor(it.draw.bonus)}
                      ${it.saved.numbers.includes(it.draw.bonus) ? "ring-2 ring-offset-1 ring-purple-400" : "opacity-40"}`}>
                      {it.draw.bonus}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <p className="text-xs text-gray-500">
                      <span className="font-bold text-gray-700">{it.matchCount}개</span> 일치
                      {it.hasBonus && <span className="ml-1 text-purple-500 font-semibold">+ 보너스</span>}
                    </p>
                    {isBought && it.prizeAmount > 0 && (
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">
                        +₩{it.prizeAmount.toLocaleString()}
                      </span>
                    )}
                    {isBought && ["1등","2등","3등"].includes(prize) && (
                      <span className="text-xs font-bold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-lg">
                        🏆 당첨금 확인!
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 대기 중 */}
              {isPending && (
                <p className="text-xs text-amber-500 mt-2">
                  토요일 추첨 후 자동으로 결과가 표시됩니다
                </p>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && !loading && items.length > 0 && (
        <div className="text-center py-10 text-gray-400 text-sm">
          해당 조건의 항목이 없어요
        </div>
      )}

    </div>
  );
}
