"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

/* ─── Types ─── */
interface MetaRow {
  id: number;
  analyzed_at: string;
  total_draws: number;
  first_draw: number;
  last_draw: number;
  decay_lambda: number;
  chi_square_stat: number;
  chi_square_pvalue: number;
  is_uniform: boolean;
  model_version: string;
}

interface NumberStat {
  number: number;
  raw_count: number;
  weighted_count: number;
  posterior_alpha: number;
  posterior_mean: number;
  posterior_std: number;
  credible_lower: number;
  credible_upper: number;
  theoretical_prob: number;
  zscore: number;
  is_hot: boolean;
  is_cold: boolean;
  bayesian_rank: number;
}

interface PairStat {
  num_a: number;
  num_b: number;
  co_count: number;
  weighted_co_count: number;
  posterior_mean: number;
  credible_lower: number;
  credible_upper: number;
  theoretical_prob: number;
}

interface DrawRow {
  draw_no: number;
  draw_date: string;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  bonus: number | null;
  num_sum: number | null;
  odd_count: number | null;
  section_count: number | null;
  consecutive_pairs: number | null;
  prize_1st: number | null;
  winners_1st: number | null;
}

/* ─── Ball ─── */
function ballColor(n: number) {
  if (n <= 10) return "bg-[#FBC400] text-black";
  if (n <= 20) return "bg-[#069FDD] text-white";
  if (n <= 30) return "bg-[#FF5757] text-white";
  if (n <= 40) return "bg-[#AAAAAA] text-white";
  return "bg-[#B0D840] text-black";
}
function Ball({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs" : size === "lg" ? "w-11 h-11 text-base" : "w-9 h-9 text-sm";
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 shadow-sm ${sz} ${ballColor(n)}`}>
      {n}
    </span>
  );
}

/* ─── Stat Card ─── */
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 text-center">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-2xl font-extrabold tracking-tight ${color ?? "text-gray-800"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── Number Bar Row ─── */
function NumberBar({ stat, maxMean, minMean }: { stat: NumberStat; maxMean: number; minMean: number }) {
  const THEO = 0.022222;
  const range = maxMean - minMean || 0.001;
  const pct = Math.round(((stat.posterior_mean - minMean) / range) * 100);
  const isTop10 = stat.bayesian_rank <= 10;
  const isBot10 = stat.bayesian_rank >= 36;

  const barColor = isTop10
    ? "bg-gradient-to-r from-orange-400 to-rose-500"
    : isBot10
    ? "bg-gradient-to-r from-sky-400 to-blue-500"
    : "bg-gradient-to-r from-gray-300 to-gray-400";

  const textColor = isTop10 ? "text-rose-600" : isBot10 ? "text-sky-600" : "text-gray-600";
  const deviationPct = ((stat.posterior_mean - THEO) / THEO * 100).toFixed(1);
  const deviationSign = stat.posterior_mean >= THEO ? "+" : "";

  return (
    <div className="flex items-center gap-2 py-1.5 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors">
      <span className={`text-[10px] font-bold w-5 text-right shrink-0 ${textColor}`}>
        #{stat.bayesian_rank}
      </span>
      <Ball n={stat.number} size="sm" />
      <div className="flex-1 relative">
        <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
      <div className="text-right shrink-0 w-24">
        <span className={`text-xs font-bold ${textColor}`}>
          {(stat.posterior_mean * 100).toFixed(3)}%
        </span>
        <span className={`text-[10px] ml-1 ${stat.posterior_mean >= THEO ? "text-rose-400" : "text-sky-400"}`}>
          ({deviationSign}{deviationPct}%)
        </span>
      </div>
    </div>
  );
}

/* ─── Pattern Bar Row ─── */
function PatternBar({
  label,
  count,
  total,
  highlight = false,
  accent = "emerald",
  badge,
}: {
  label: string;
  count: number;
  total: number;
  highlight?: boolean;
  accent?: "emerald" | "violet" | "amber" | "sky";
  badge?: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const barColors: Record<string, string> = {
    emerald: "bg-gradient-to-r from-emerald-400 to-teal-500",
    violet: "bg-gradient-to-r from-violet-400 to-purple-500",
    amber: "bg-gradient-to-r from-amber-400 to-orange-500",
    sky: "bg-gradient-to-r from-sky-400 to-blue-500",
  };
  const textColors: Record<string, string> = {
    emerald: "text-emerald-700",
    violet: "text-violet-700",
    amber: "text-amber-700",
    sky: "text-sky-700",
  };
  const bgColors: Record<string, string> = {
    emerald: "bg-emerald-50",
    violet: "bg-violet-50",
    amber: "bg-amber-50",
    sky: "bg-sky-50",
  };

  return (
    <div className={`flex items-center gap-2 py-1.5 rounded-xl px-2 -mx-2 transition-colors
      ${highlight ? bgColors[accent] : "hover:bg-gray-50"}`}>
      {/* Label */}
      <div className="flex items-center gap-1 w-20 shrink-0">
        <span className={`text-[11px] font-semibold ${highlight ? textColors[accent] : "text-gray-500"}`}>
          {label}
        </span>
        {badge && (
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
            highlight ? `bg-${accent}-100 ${textColors[accent]}` : "bg-gray-100 text-gray-400"
          }`}>
            {badge}
          </span>
        )}
      </div>
      {/* Bar */}
      <div className="flex-1">
        <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${highlight ? barColors[accent] : "bg-gray-300"}`}
            style={{ width: `${Math.max(pct, 0.3)}%` }}
          />
        </div>
      </div>
      {/* Pct */}
      <div className="text-right w-20 shrink-0">
        <span className={`text-[11px] font-bold ${highlight ? textColors[accent] : "text-gray-400"}`}>
          {pct.toFixed(1)}%
        </span>
        <span className="text-[10px] text-gray-300 ml-1">({count})</span>
      </div>
    </div>
  );
}

/* ─── passPatternFilter (same logic as generate page) ─── */
function passFilter(nums: number[]): boolean {
  const sum = nums.reduce((a, b) => a + b, 0);
  const odd = nums.filter(n => n % 2 === 1).length;
  const sorted = [...nums].sort((a, b) => a - b);
  const secs = new Set(sorted.map(n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5)).size;
  let cons = 0;
  for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) cons++;
  return sum >= 100 && sum <= 159 && (odd === 3 || odd === 4) && secs >= 3 && cons >= 1;
}

/* ─── Page ─── */
export default function StatsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [meta, setMeta]     = useState<MetaRow | null>(null);
  const [nums, setNums]     = useState<NumberStat[]>([]);
  const [pairs, setPairs]   = useState<PairStat[]>([]);
  const [draws, setDraws]   = useState<DrawRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<"rank" | "number">("rank");
  const [patternTab, setPatternTab] = useState<"sum" | "odd" | "sec" | "con" | "end">("sum");

  useEffect(() => {
    Promise.all([
      supabase.from("lotto_analysis_meta").select("*").order("id", { ascending: false }).limit(1).single(),
      supabase.from("lotto_number_stats").select("*").order("bayesian_rank"),
      supabase.from("lotto_pair_stats").select("*").order("posterior_mean", { ascending: false }).limit(20),
      supabase.from("lotto_draws").select("draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus,num_sum,odd_count,section_count,consecutive_pairs").order("draw_no").limit(2000),
    ]).then(([{ data: metaData }, { data: numsData }, { data: pairsData }, { data: drawsData }]) => {
      if (metaData) setMeta(metaData as MetaRow);
      if (numsData) setNums(numsData as NumberStat[]);
      if (pairsData) setPairs(pairsData as PairStat[]);
      if (drawsData) setDraws(drawsData as DrawRow[]);
      setLoading(false);
    });
  }, [supabase]);

  const sortedNums = useMemo(() => {
    if (sortMode === "number") return [...nums].sort((a, b) => a.number - b.number);
    return nums;
  }, [nums, sortMode]);

  const maxMean = useMemo(() => Math.max(...nums.map(n => n.posterior_mean)), [nums]);
  const minMean = useMemo(() => Math.min(...nums.map(n => n.posterior_mean)), [nums]);
  const hotNums  = useMemo(() => nums.slice(0, 10), [nums]);
  const coldNums = useMemo(() => nums.slice(-10), [nums]);

  /* ─── 오버듀 분석 ─── */
  const overdueStats = useMemo(() => {
    if (draws.length === 0) return [];
    const total = draws.length;
    const freq = new Array(46).fill(0);
    const lastIdx = new Array(46).fill(-1); // -1 = 한 번도 안 나옴

    // draws는 오래된 순 (index 0 = 가장 오래된 회차)
    draws.forEach((d, i) => {
      [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(n => {
        freq[n]++;
        lastIdx[n] = i; // 마지막 출현 인덱스 (오래된 순 기준)
      });
    });

    return Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
      const count = freq[n];
      const avgPeriod = count > 0 ? total / count : total;
      const gapFromLatest = count > 0 ? (total - 1 - lastIdx[n]) : total; // 최신 회차에서 얼마나 전
      const overdueScore = gapFromLatest / avgPeriod;
      return { number: n, count, avgPeriod, gapFromLatest, overdueScore };
    }).sort((a, b) => b.overdueScore - a.overdueScore);
  }, [draws]);

  /* ─── 패턴 분석 계산 ─── */
  const patternStats = useMemo(() => {
    if (draws.length === 0) return null;
    const total = draws.length;

    // 합계 분포 (10구간 히스토그램)
    const sumLabels = ["~89","90-99","100-109","110-119","120-129","130-139","140-149","150-159","160-169","170-179","180+"];
    const sumCounts = new Array(sumLabels.length).fill(0);
    const sumHighlight = [false,false,true,true,true,true,true,true,false,false,false]; // 100~159

    // 홀짝 분포
    const oddLabels  = ["0홀6짝","1홀5짝","2홀4짝","3홀3짝","4홀2짝","5홀1짝","6홀0짝"];
    const oddCounts  = new Array(7).fill(0);
    const oddHighlight = [false,false,false,true,true,false,false]; // odd===3||4

    // 구간 커버 분포 (몇 구간에서 나왔는지)
    const secLabels  = ["1구간","2구간","3구간","4구간","5구간"];
    const secCounts  = new Array(5).fill(0);
    const secHighlight = [false,false,true,true,true]; // secs>=3

    // 연속번호 쌍 수
    const conLabels  = ["0쌍","1쌍","2쌍","3쌍+"];
    const conCounts  = new Array(4).fill(0);
    const conHighlight = [false,true,true,true]; // cons>=1

    // 끝자리 유니크 수
    const endLabels  = ["1개","2개","3개","4개","5개","6개"];
    const endCounts  = new Array(6).fill(0);

    let passCount = 0;

    draws.forEach(d => {
      const nums = [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6];
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      const sorted = [...nums].sort((a, b) => a - b);
      const secs = new Set(sorted.map(n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5)).size;
      let cons = 0;
      for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) cons++;
      const endUniq = new Set(nums.map(n => n % 10)).size;

      // 합계 버킷
      const si = sum < 90 ? 0 : sum < 100 ? 1 : sum < 110 ? 2 : sum < 120 ? 3 : sum < 130 ? 4
              : sum < 140 ? 5 : sum < 150 ? 6 : sum < 160 ? 7 : sum < 170 ? 8 : sum < 180 ? 9 : 10;
      sumCounts[si]++;

      oddCounts[odd]++;
      secCounts[secs - 1]++;
      conCounts[Math.min(cons, 3)]++;
      endCounts[endUniq - 1]++;

      if (passFilter(nums)) passCount++;
    });

    // 패턴 통과율 세부 분해
    let passSum = 0, passOdd = 0, passSec = 0, passCon = 0;
    draws.forEach(d => {
      const nums = [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6];
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      const sorted = [...nums].sort((a, b) => a - b);
      const secs = new Set(sorted.map(n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5)).size;
      let cons = 0;
      for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) cons++;
      if (sum >= 100 && sum <= 159) passSum++;
      if (odd === 3 || odd === 4) passOdd++;
      if (secs >= 3) passSec++;
      if (cons >= 1) passCon++;
    });

    return {
      total,
      passCount,
      passSum, passOdd, passSec, passCon,
      sum: { labels: sumLabels, counts: sumCounts, highlight: sumHighlight },
      odd: { labels: oddLabels, counts: oddCounts, highlight: oddHighlight },
      sec: { labels: secLabels, counts: secCounts, highlight: secHighlight },
      con: { labels: conLabels, counts: conCounts, highlight: conHighlight },
      end: { labels: endLabels, counts: endCounts },
    };
  }, [draws]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-4xl animate-pulse">📊</div>
        <p className="text-gray-400 text-sm font-medium">베이지안 분석 데이터 로딩 중...</p>
      </div>
    );
  }

  /* ─── 패턴 탭 현재 데이터 ─── */
  const tabData = patternStats ? {
    sum: patternStats.sum,
    odd: patternStats.odd,
    sec: patternStats.sec,
    con: patternStats.con,
    end: { ...patternStats.end, highlight: [false, false, false, true, true, true] }, // 끝자리 4~6종 분산이 좋음
  }[patternTab] : null;

  const tabAccents: Record<typeof patternTab, "emerald" | "violet" | "amber" | "sky"> = {
    sum: "emerald",
    odd: "violet",
    sec: "amber",
    con: "sky",
    end: "sky",
  };

  return (
    <div className="px-4 py-5 md:px-6 lg:px-8 max-w-3xl mx-auto">

      {/* ── 베이지안 헤더 ── */}
      <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 rounded-2xl p-5 mb-5 shadow-lg text-center relative overflow-hidden">
        <div className="absolute top-2 left-3 text-white/10 text-5xl select-none">🧮</div>
        <div className="absolute bottom-2 right-3 text-white/10 text-5xl select-none">📈</div>
        <div className="relative">
          <div className="text-4xl mb-1.5">🧮</div>
          <h2 className="text-white font-extrabold text-lg tracking-tight">베이지안 통계 분석</h2>
          <p className="text-white/70 text-xs mt-1">
            <span className="text-violet-200 font-semibold">Dirichlet-Multinomial</span>
            <span className="text-white/40 mx-1.5">·</span>
            <span className="text-violet-200 font-semibold">Beta-Binomial</span>
            <span className="text-white/40 mx-1.5">·</span>
            <span className="text-violet-200 font-semibold">시간감쇠 λ=0.998</span>
          </p>
          {meta && (
            <p className="text-white/50 text-[11px] mt-1.5">
              {meta.analyzed_at.slice(0, 10)} 기준 · v{meta.model_version}
            </p>
          )}
        </div>
      </div>

      {/* ── 🎯 최신 회차 분석 카드 ── */}
      {(() => {
        if (draws.length === 0 || nums.length === 0) return null;
        const latest = draws[draws.length - 1];
        const latestNums = [latest.n1, latest.n2, latest.n3, latest.n4, latest.n5, latest.n6];
        const hotSet = new Set(nums.slice(0, 10).map(n => n.number));
        const coldSet = new Set(nums.slice(-10).map(n => n.number));
        const hotHits = latestNums.filter(n => hotSet.has(n));
        const coldHits = latestNums.filter(n => coldSet.has(n));

        const sum = latestNums.reduce((a, b) => a + b, 0);
        const odd = latestNums.filter(n => n % 2 === 1).length;
        const sorted = [...latestNums].sort((a, b) => a - b);
        const secs = new Set(sorted.map(n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5)).size;
        let cons = 0;
        for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) cons++;
        const passed = sum >= 100 && sum <= 159 && (odd === 3 || odd === 4) && secs >= 3 && cons >= 1;

        const checks = [
          { label: `합계 ${sum}`, pass: sum >= 100 && sum <= 159, cond: "100~159" },
          { label: `홀수 ${odd}개`, pass: odd === 3 || odd === 4, cond: "3~4개" },
          { label: `${secs}구간`, pass: secs >= 3, cond: "3구간+" },
          { label: `연속 ${cons}쌍`, pass: cons >= 1, cond: "1쌍+" },
        ];

        return (
          <div className="bg-white border-2 border-violet-200 rounded-2xl p-4 mb-5 shadow-sm">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🎯</span>
                <span className="text-sm font-extrabold text-gray-800">{latest.draw_no}회 최신 당첨번호 분석</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                  {latest.draw_date?.slice(0, 10) ?? ""}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                  ✓ 통계 반영 완료
                </span>
              </div>
            </div>

            {/* 당첨번호 공 */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {latestNums.map((n, i) => (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <Ball n={n} size="lg" />
                  {hotSet.has(n) && <span className="text-[9px] font-bold text-rose-500">🔥</span>}
                  {coldSet.has(n) && <span className="text-[9px] font-bold text-sky-500">❄️</span>}
                  {!hotSet.has(n) && !coldSet.has(n) && <span className="text-[9px] text-transparent">·</span>}
                </div>
              ))}
              <span className="text-gray-300 font-bold mx-1 text-lg">+</span>
              <div className="flex flex-col items-center gap-0.5">
                <div className={`inline-flex items-center justify-center rounded-full font-bold w-11 h-11 text-base shadow-sm border-2 border-dashed border-gray-400 bg-gray-100 text-gray-600`}>
                  {latest.bonus}
                </div>
                <span className="text-[9px] text-gray-400">보너스</span>
              </div>
            </div>

            {/* 핫/콜드 적중 */}
            <div className="flex gap-2 mb-3">
              <div className={`flex-1 rounded-xl p-2.5 text-center border ${hotHits.length >= 3 ? "bg-rose-50 border-rose-200" : "bg-gray-50 border-gray-200"}`}>
                <p className="text-[10px] text-gray-400 mb-0.5">🔥 핫번호 적중</p>
                <p className={`text-xl font-extrabold ${hotHits.length >= 3 ? "text-rose-600" : "text-gray-600"}`}>{hotHits.length}<span className="text-xs font-normal text-gray-400"> / 6개</span></p>
                {hotHits.length > 0 && (
                  <div className="flex gap-1 justify-center mt-1">
                    {hotHits.map(n => <Ball key={n} n={n} size="sm" />)}
                  </div>
                )}
              </div>
              <div className={`flex-1 rounded-xl p-2.5 text-center border ${coldHits.length >= 2 ? "bg-sky-50 border-sky-200" : "bg-gray-50 border-gray-200"}`}>
                <p className="text-[10px] text-gray-400 mb-0.5">❄️ 콜드번호 포함</p>
                <p className={`text-xl font-extrabold ${coldHits.length >= 2 ? "text-sky-600" : "text-gray-600"}`}>{coldHits.length}<span className="text-xs font-normal text-gray-400"> / 6개</span></p>
                {coldHits.length > 0 && (
                  <div className="flex gap-1 justify-center mt-1">
                    {coldHits.map(n => <Ball key={n} n={n} size="sm" />)}
                  </div>
                )}
              </div>
            </div>

            {/* 패턴 체크 */}
            <div className="grid grid-cols-4 gap-1.5 mb-3">
              {checks.map(({ label, pass, cond }) => (
                <div key={cond} className={`rounded-xl p-2 text-center border ${pass ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                  <p className={`text-base font-extrabold ${pass ? "text-emerald-600" : "text-rose-500"}`}>{pass ? "✅" : "❌"}</p>
                  <p className={`text-[10px] font-bold mt-0.5 ${pass ? "text-emerald-700" : "text-rose-600"}`}>{label}</p>
                  <p className="text-[9px] text-gray-400">{cond}</p>
                </div>
              ))}
            </div>

            {/* 패턴 최종 판정 */}
            <div className={`rounded-xl p-2.5 text-center border ${passed ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
              <p className={`text-xs font-extrabold ${passed ? "text-emerald-700" : "text-amber-700"}`}>
                {passed ? "✅ 4조건 모두 통과 — 패턴 필터 합격" : "⚠️ 일부 조건 미통과 — 이런 회차도 있어요"}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">역대 1등 당첨번호의 약 38~42%가 4조건 동시 통과</p>
            </div>
          </div>
        );
      })()}

      {/* ── 요약 카드 4개 ── */}
      {meta && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <StatCard
            label="분석 회차"
            value={`${meta.total_draws.toLocaleString()}회`}
            sub={`${meta.first_draw}회 ~ ${meta.last_draw}회`}
          />
          <StatCard
            label="카이제곱 검정"
            value={meta.chi_square_stat.toFixed(2)}
            sub={`p = ${meta.chi_square_pvalue.toFixed(4)}`}
          />
          <StatCard
            label="복권 공정성"
            value={meta.is_uniform ? "✓ 공정" : "⚠ 편향"}
            sub="H₀: 균등분포 채택"
            color={meta.is_uniform ? "text-emerald-600" : "text-rose-600"}
          />
          <StatCard
            label="유효 가중치"
            value="37.3%"
            sub="λ=0.998 시간감쇠 적용"
          />
        </div>
      )}

      {/* ── 번호별 확률 순위 ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-800">번호별 사후확률</h3>
          <div className="flex gap-1.5">
            {(["rank", "number"] as const).map(m => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition
                  ${sortMode === m ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
              >
                {m === "rank" ? "확률순" : "번호순"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 mb-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-orange-400 to-rose-500 shrink-0" />핫 (상위 10)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-sky-400 to-blue-500 shrink-0" />콜드 (하위 10)</span>
          <span className="text-gray-400">이론값 2.222%</span>
        </div>
        <div className="divide-y divide-gray-50">
          {sortedNums.map(stat => (
            <NumberBar key={stat.number} stat={stat} maxMean={maxMean} minMean={minMean} />
          ))}
        </div>
      </div>

      {/* ── 핫 번호 TOP 10 ── */}
      <div className="bg-gradient-to-br from-orange-50 to-rose-50 border border-orange-200 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">🔥</span>
          <h3 className="text-sm font-bold text-orange-700">핫 번호 TOP 10</h3>
          <span className="text-[10px] text-orange-400 ml-auto">사후확률 상위 10개</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {hotNums.map(stat => (
            <div key={stat.number} className="flex flex-col items-center gap-1">
              <Ball n={stat.number} size="md" />
              <span className="text-[10px] font-bold text-orange-600">
                {(stat.posterior_mean * 100).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 콜드 번호 TOP 10 ── */}
      <div className="bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 rounded-2xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">❄️</span>
          <h3 className="text-sm font-bold text-sky-700">콜드 번호 TOP 10</h3>
          <span className="text-[10px] text-sky-400 ml-auto">사후확률 하위 10개</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {coldNums.map(stat => (
            <div key={stat.number} className="flex flex-col items-center gap-1">
              <Ball n={stat.number} size="md" />
              <span className="text-[10px] font-bold text-sky-600">
                {(stat.posterior_mean * 100).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── ⏰ 오버듀 분석 ── */}
      {overdueStats.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">⏰</span>
            <h3 className="text-sm font-bold text-gray-800">오버듀 분석 — 오래 안 나온 번호</h3>
            <span className="text-[10px] text-gray-400 ml-auto">TOP 10</span>
          </div>
          <div className="divide-y divide-gray-50">
            {overdueStats.slice(0, 10).map(stat => {
              const barPct = Math.min((stat.overdueScore / 2.0) * 100, 100);
              const scoreColor =
                stat.overdueScore >= 2.0 ? "text-red-600" :
                stat.overdueScore >= 1.5 ? "text-orange-500" :
                stat.overdueScore >= 1.0 ? "text-yellow-600" :
                "text-gray-400";
              const barColor =
                stat.overdueScore >= 2.0 ? "bg-gradient-to-r from-red-400 to-rose-500" :
                stat.overdueScore >= 1.5 ? "bg-gradient-to-r from-orange-400 to-amber-500" :
                stat.overdueScore >= 1.0 ? "bg-gradient-to-r from-yellow-400 to-amber-400" :
                "bg-gray-300";
              return (
                <div key={stat.number} className="flex items-center gap-2 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors">
                  <Ball n={stat.number} size="sm" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                      <span>
                        경과 <strong>{stat.gapFromLatest}</strong>회
                        <span className="text-gray-300 mx-1">·</span>
                        평균주기 <strong>{stat.avgPeriod.toFixed(1)}</strong>회
                      </span>
                      <span className={`font-bold ${scoreColor}`}>
                        ⏰ {stat.overdueScore.toFixed(2)}x
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${Math.max(barPct, 2)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 bg-gray-50 rounded-lg p-2 leading-relaxed">
            오버듀 지수 1.0 = 평균 주기만큼 미출현. 2.0 = 평균의 2배 기다리는 중. 수학적으로 출현 확률을 높이지는 않으나 참고 지표로 활용.
          </p>
        </div>
      )}

      {/* ── 최강 페어 TOP 20 ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">🔗</span>
          <h3 className="text-sm font-bold text-gray-800">동반출현 강한 페어 TOP 20</h3>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-center px-2 mb-2">
          <span className="text-[10px] font-bold text-gray-400">순위</span>
          <span className="text-[10px] font-bold text-gray-400">번호 쌍</span>
          <span className="text-[10px] font-bold text-gray-400 text-right">동반횟수</span>
          <span className="text-[10px] font-bold text-gray-400 text-right">베이즈 확률</span>
        </div>
        <div className="divide-y divide-gray-50">
          {pairs.map((pair, i) => {
            const overTheo = pair.posterior_mean > pair.theoretical_prob;
            return (
              <div key={`${pair.num_a}-${pair.num_b}`}
                className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-center py-2 px-2 hover:bg-gray-50 rounded-lg transition-colors">
                <span className={`text-[11px] font-bold w-5 ${i < 5 ? "text-violet-600" : "text-gray-400"}`}>
                  #{i + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  <Ball n={pair.num_a} size="sm" />
                  <span className="text-gray-300 text-xs font-bold">+</span>
                  <Ball n={pair.num_b} size="sm" />
                </div>
                <span className="text-xs text-gray-600 font-semibold text-right">{pair.co_count}회</span>
                <div className="text-right">
                  <span className={`text-xs font-bold ${overTheo ? "text-violet-600" : "text-gray-500"}`}>
                    {(pair.posterior_mean * 100).toFixed(3)}%
                  </span>
                  <br />
                  <span className={`text-[10px] ${overTheo ? "text-violet-400" : "text-sky-400"}`}>
                    {overTheo ? "▲" : "▼"} 이론{(pair.theoretical_prob * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ════════════════════════════════════════════════ */}
      {/* ── 🏆 1등 당첨번호 패턴 분석 ── */}
      {/* ════════════════════════════════════════════════ */}
      {patternStats && (
        <>
          {/* 섹션 헤더 */}
          <div className="bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 rounded-2xl p-5 mb-5 shadow-lg text-center relative overflow-hidden">
            <div className="absolute top-2 left-3 text-white/10 text-5xl select-none">🏆</div>
            <div className="absolute bottom-2 right-3 text-white/10 text-5xl select-none">📐</div>
            <div className="relative">
              <div className="text-4xl mb-1.5">🏆</div>
              <h2 className="text-white font-extrabold text-lg tracking-tight">1등 당첨번호 패턴 분석</h2>
              <p className="text-white/70 text-xs mt-1">
                <span className="text-teal-200 font-semibold">역대 {patternStats.total}회차</span>
                <span className="text-white/40 mx-1.5">·</span>
                <span className="text-teal-200 font-semibold">합계 · 홀짝 · 구간 · 연속번호</span>
              </p>
              <p className="text-white/50 text-[11px] mt-1.5">
                실제 1등 당첨번호 기반 조합 특성 통계
              </p>
            </div>
          </div>

          {/* 필터 통과율 + 세부 지표 */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <span>🎯</span> 패턴 필터 조건별 통과율
            </h3>
            {/* 전체 통과율 - 크게 */}
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 mb-4 text-center">
              <p className="text-xs text-emerald-600 font-semibold mb-1">4조건 동시 통과</p>
              <p className="text-4xl font-extrabold text-emerald-600 tracking-tight">
                {((patternStats.passCount / patternStats.total) * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {patternStats.total}회차 중 {patternStats.passCount}회 해당
              </p>
            </div>
            {/* 조건별 개별 통과율 */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "합계 100~159", count: patternStats.passSum, icon: "📊", color: "emerald" },
                { label: "홀수 3~4개", count: patternStats.passOdd, icon: "⚖️", color: "violet" },
                { label: "구간 3개+", count: patternStats.passSec, icon: "📍", color: "amber" },
                { label: "연속 1쌍+", count: patternStats.passCon, icon: "🔗", color: "sky" },
              ].map(({ label, count, icon, color }) => {
                const pct = ((count / patternStats.total) * 100).toFixed(1);
                const textCls = color === "emerald" ? "text-emerald-600" : color === "violet" ? "text-violet-600" : color === "amber" ? "text-amber-600" : "text-sky-600";
                const bgCls = color === "emerald" ? "bg-emerald-50 border-emerald-200" : color === "violet" ? "bg-violet-50 border-violet-200" : color === "amber" ? "bg-amber-50 border-amber-200" : "bg-sky-50 border-sky-200";
                return (
                  <div key={label} className={`${bgCls} border rounded-xl p-3 text-center`}>
                    <p className="text-base mb-0.5">{icon}</p>
                    <p className={`text-xl font-extrabold ${textCls}`}>{pct}%</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 분포 상세 차트 - 탭 전환 */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
            {/* 탭 버튼 */}
            <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
              {(["sum","odd","sec","con","end"] as const).map(tab => {
                const labels: Record<typeof tab, string> = { sum: "📊 합계분포", odd: "⚖️ 홀짝비율", sec: "📍 구간커버", con: "🔗 연속번호", end: "🔢 끝자리분산" };
                const activeBgs: Record<string, string> = { sum: "bg-emerald-600 text-white", odd: "bg-violet-600 text-white", sec: "bg-amber-500 text-white", con: "bg-sky-500 text-white", end: "bg-sky-600 text-white" };
                return (
                  <button
                    key={tab}
                    onClick={() => setPatternTab(tab)}
                    className={`text-[11px] px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition shrink-0
                      ${patternTab === tab ? activeBgs[tab] : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>

            {/* 탭 설명 */}
            {patternTab === "sum" && (
              <p className="text-[11px] text-gray-400 mb-3 bg-emerald-50 rounded-lg px-3 py-2">
                <span className="text-emerald-600 font-bold">★ 필터 기준:</span> 합계 100~159 (6개 구간)
                <span className="text-gray-300 mx-2">·</span> 이 범위가 역대 당첨번호에서 가장 자주 출현
              </p>
            )}
            {patternTab === "odd" && (
              <p className="text-[11px] text-gray-400 mb-3 bg-violet-50 rounded-lg px-3 py-2">
                <span className="text-violet-600 font-bold">★ 필터 기준:</span> 홀수 3개 또는 4개
                <span className="text-gray-300 mx-2">·</span> 3홀3짝·4홀2짝이 전체의 절반 이상 차지
              </p>
            )}
            {patternTab === "sec" && (
              <p className="text-[11px] text-gray-400 mb-3 bg-amber-50 rounded-lg px-3 py-2">
                <span className="text-amber-600 font-bold">★ 필터 기준:</span> 구간 3개 이상
                <span className="text-gray-300 mx-2">·</span> 구간: 1~10, 11~20, 21~30, 31~40, 41~45
              </p>
            )}
            {patternTab === "con" && (
              <p className="text-[11px] text-gray-400 mb-3 bg-sky-50 rounded-lg px-3 py-2">
                <span className="text-sky-600 font-bold">★ 필터 기준:</span> 연속번호 1쌍 이상
                <span className="text-gray-300 mx-2">·</span> 연속번호(예: 5,6)가 1쌍 이상 포함된 회차가 다수
              </p>
            )}
            {patternTab === "end" && (
              <p className="text-[11px] text-gray-400 mb-3 bg-sky-50 rounded-lg px-3 py-2">
                <span className="text-sky-600 font-bold">★ 참고 지표:</span> 끝자리(일의 자리) 유니크 수
                <span className="text-gray-300 mx-2">·</span> 끝자리 4~6종이 분산된 회차가 이상적 (1~11, 21~31 같은 편중 조합 회피)
              </p>
            )}

            {/* 바 차트 */}
            {tabData && (
              <div className="space-y-0.5">
                {tabData.labels.map((label, i) => (
                  <PatternBar
                    key={label}
                    label={label}
                    count={tabData.counts[i]}
                    total={patternStats.total}
                    highlight={tabData.highlight[i]}
                    accent={tabAccents[patternTab]}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 필터 조건 요약 카드 */}
          <div className="bg-gradient-to-br from-gray-50 to-slate-50 border border-gray-200 rounded-2xl p-4 mb-5">
            <h3 className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              <span>🔍</span> 현재 적용 중인 패턴 필터
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { icon: "📊", label: "합계", cond: "100 ~ 159" },
                { icon: "⚖️", label: "홀수 개수", cond: "3개 또는 4개" },
                { icon: "📍", label: "구간 커버", cond: "3구간 이상" },
                { icon: "🔗", label: "연속번호", cond: "1쌍 이상" },
              ].map(({ icon, label, cond }) => (
                <div key={label} className="flex items-start gap-2 bg-white rounded-xl p-2.5 border border-gray-100">
                  <span className="text-base shrink-0">{icon}</span>
                  <div>
                    <p className="font-bold text-gray-700 text-[11px]">{label}</p>
                    <p className="text-emerald-600 font-semibold text-[11px]">{cond}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── 모델 설명 ── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-5">
        <h3 className="text-xs font-bold text-gray-600 mb-2">📖 분석 모델 설명</h3>
        <div className="space-y-1.5 text-xs text-gray-500">
          <p>• <span className="font-semibold text-gray-700">Dirichlet-Multinomial</span>: 각 번호의 출현 확률을 베이지안 업데이트로 추정</p>
          <p>• <span className="font-semibold text-gray-700">Beta-Binomial</span>: 번호 쌍의 동반출현 확률 추정</p>
          <p>• <span className="font-semibold text-gray-700">시간감쇠 λ=0.998</span>: 최근 회차에 더 높은 가중치 부여</p>
          <p>• <span className="font-semibold text-gray-700">95% 신뢰구간</span>: Beta 분포 근사로 불확실성 정량화</p>
          <p>• <span className="font-semibold text-gray-700">카이제곱 검정 p=0.9662</span>: 복권은 통계적으로 공정 (H₀ 채택)</p>
          <p>• <span className="font-semibold text-gray-700">패턴 필터</span>: 역대 1등 조합의 통계적 특성 기반 (generate 페이지와 동일 조건)</p>
        </div>
      </div>

      <p className="text-center text-xs text-gray-300 pb-4">
        {meta?.total_draws ?? 0}회차 데이터 기반 · 당첨 보장 아님 · 통계적 참고자료입니다 🧮
      </p>

    </div>
  );
}
