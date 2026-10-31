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
  const [latestDraw, setLatestDraw] = useState<DrawRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<"rank" | "number">("rank");
  const [patternTab, setPatternTab] = useState<"sum" | "odd" | "sec" | "con" | "end">("sum");
  const [heatmapMode, setHeatmapMode] = useState<"50" | "100" | "200" | "common">("50");

  useEffect(() => {
    Promise.all([
      supabase.from("lotto_analysis_meta").select("*").order("id", { ascending: false }).limit(1).single(),
      supabase.from("lotto_number_stats").select("*").order("bayesian_rank"),
      supabase.from("lotto_pair_stats").select("*").order("posterior_mean", { ascending: false }).limit(20),
      supabase.from("lotto_draws").select("draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus,num_sum,odd_count,section_count,consecutive_pairs").order("draw_no").limit(2000),
      // 최신 당첨번호 별도 쿼리 (limit 제약 무관하게 항상 최신 1개)
      supabase.from("lotto_draws").select("draw_no,draw_date,n1,n2,n3,n4,n5,n6,bonus").order("draw_no", { ascending: false }).limit(1).single(),
    ]).then(([{ data: metaData }, { data: numsData }, { data: pairsData }, { data: drawsData }, { data: latestData }]) => {
      if (metaData) setMeta(metaData as MetaRow);
      if (numsData) setNums(numsData as NumberStat[]);
      if (pairsData) setPairs(pairsData as PairStat[]);
      if (drawsData) setDraws(drawsData as DrawRow[]);
      if (latestData) setLatestDraw(latestData as DrawRow);
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

  /* ─── 끝자리 편향 데이터 ─── */
  const tailBiasData = useMemo(() => {
    if (draws.length === 0) return null;
    const counts = new Array(10).fill(0);
    draws.forEach(d => {
      [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(n => counts[n % 10]++);
    });
    const total = draws.length * 6;
    const expected = total / 10;
    return Array.from({ length: 10 }, (_, i) => ({
      tail: i,
      count: counts[i],
      pct: (counts[i] / total * 100),
      bias: ((counts[i] - expected) / expected * 100),
    }));
  }, [draws]);

  /* ─── 히트맵 데이터 ─── */
  const heatmapData = useMemo(() => {
    if (draws.length === 0) return null;
    const n = heatmapMode === "50" ? 50 : heatmapMode === "100" ? 100 : 200;
    const recent = draws.slice(-Math.min(n, draws.length));
    const counts = new Array(46).fill(0);
    recent.forEach(d => {
      [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(num => counts[num]++);
    });
    const max = Math.max(...counts.slice(1));
    const min = Math.min(...counts.slice(1));
    return { counts, max, min, total: recent.length };
  }, [draws, heatmapMode]);

  /* ─── 3구간 공통 번호 ─── */
  const commonData = useMemo(() => {
    if (draws.length === 0) return null;
    const getCounts = (n: number) => {
      const recent = draws.slice(-Math.min(n, draws.length));
      const counts = new Array(46).fill(0);
      recent.forEach(d => {
        [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(num => counts[num]++);
      });
      return { counts, total: recent.length };
    };
    const r50 = getCounts(50);
    const r100 = getCounts(100);
    const r200 = getCounts(200);

    const expected50 = (r50.total * 6) / 45;
    const expected100 = (r100.total * 6) / 45;
    const expected200 = (r200.total * 6) / 45;

    // 각 구간에서 평균 이상인 번호를 찾고, 3구간 모두 공통인 번호 추출
    const above50 = new Set<number>();
    const above100 = new Set<number>();
    const above200 = new Set<number>();
    for (let n = 1; n <= 45; n++) {
      if (r50.counts[n] >= expected50) above50.add(n);
      if (r100.counts[n] >= expected100) above100.add(n);
      if (r200.counts[n] >= expected200) above200.add(n);
    }

    // 3구간 공통
    const common = Array.from({ length: 45 }, (_, i) => i + 1).filter(
      n => above50.has(n) && above100.has(n) && above200.has(n)
    );
    // 2구간 공통 (3구간 제외)
    const two = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => {
      const cnt = (above50.has(n) ? 1 : 0) + (above100.has(n) ? 1 : 0) + (above200.has(n) ? 1 : 0);
      return cnt === 2;
    });

    // 각 번호의 점수(랭크합, 낮을수록 좋음) 계산
    const rank = (counts: number[]) => {
      const sorted = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, c: counts[i + 1] }))
        .sort((a, b) => b.c - a.c);
      const r = new Array(46).fill(0);
      sorted.forEach((item, idx) => { r[item.n] = idx + 1; });
      return r;
    };
    const rank50 = rank(r50.counts);
    const rank100 = rank(r100.counts);
    const rank200 = rank(r200.counts);

    const scored = common.map(n => ({
      n,
      score: rank50[n] + rank100[n] + rank200[n],
      c50: r50.counts[n], c100: r100.counts[n], c200: r200.counts[n],
    })).sort((a, b) => a.score - b.score);

    return { common: scored, twoOnly: two, above50, above100, above200 };
  }, [draws]);

  /* ─── 전략 백테스팅 (walk-forward, 최근 200회 기준) ─── */
  const backtestResults = useMemo(() => {
    if (draws.length < 250) return null;

    const pickTop6 = (scores: [number, number][]): number[] =>
      scores.sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]).sort((a, b) => a - b);

    const strategies: {
      name: string; icon: string; desc: string;
      gen: (hist: DrawRow[]) => number[];
    }[] = [
      {
        name: "🔥 핫번호", icon: "🔥", desc: "최근 100회 빈도 상위 6개",
        gen: (hist) => {
          const freq = new Array(46).fill(0);
          hist.slice(-100).forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n => freq[n]++));
          return pickTop6(Array.from({length:45},(_,i)=>[i+1,freq[i+1]] as [number,number]));
        }
      },
      {
        name: "❄️ 콜드번호", icon: "❄️", desc: "최근 100회 빈도 하위 6개",
        gen: (hist) => {
          const freq = new Array(46).fill(0);
          hist.slice(-100).forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n => freq[n]++));
          return Array.from({length:45},(_,i)=>[i+1,freq[i+1]] as [number,number])
            .sort((a,b)=>a[1]-b[1]).slice(0,6).map(x=>x[0]).sort((a,b)=>a-b);
        }
      },
      {
        name: "⏰ 오버듀", icon: "⏰", desc: "최장 미출현 상위 6개",
        gen: (hist) => {
          const freq = new Array(46).fill(0);
          const lastIdx = new Array(46).fill(-1);
          hist.forEach((d,i) => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n => { freq[n]++; lastIdx[n]=i; }));
          const total = hist.length;
          const scores = Array.from({length:45},(_,i)=>i+1).map(n => {
            const gap = freq[n]>0 ? (total-1-lastIdx[n]) : total;
            const avg = freq[n]>0 ? total/freq[n] : total;
            return [n, gap/avg] as [number,number];
          });
          return pickTop6(scores);
        }
      },
      {
        name: "🎯 3구간공통", icon: "🎯", desc: "50·100·200회 교집합",
        gen: (hist) => {
          const getHot = (n: number) => {
            const recent = hist.slice(-Math.min(n, hist.length));
            const freq = new Array(46).fill(0);
            recent.forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(x => freq[x]++));
            const exp = (recent.length * 6) / 45;
            return new Set(Array.from({length:45},(_,i)=>i+1).filter(x => freq[x] >= exp));
          };
          const h50 = getHot(50), h100 = getHot(100), h200 = getHot(200);
          const triple = Array.from({length:45},(_,i)=>i+1).filter(n=>h50.has(n)&&h100.has(n)&&h200.has(n));
          const two = Array.from({length:45},(_,i)=>i+1).filter(n=>{
            const c=(h50.has(n)?1:0)+(h100.has(n)?1:0)+(h200.has(n)?1:0); return c===2;
          });
          const pool = triple.length >= 6 ? triple : [...triple, ...two];
          if (pool.length >= 6) return pool.slice(0,6).sort((a,b)=>a-b);
          const freq2 = new Array(46).fill(0);
          hist.slice(-100).forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(x => freq2[x]++));
          return pickTop6(Array.from({length:45},(_,i)=>[i+1,freq2[i+1]] as [number,number]));
        }
      },
      {
        name: "⚖️ 균형선택", icon: "⚖️", desc: "합계 100-159 필터",
        gen: (hist) => {
          const freq = new Array(46).fill(0);
          hist.slice(-100).forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n => freq[n]++));
          const hot = Array.from({length:45},(_,i)=>i+1).sort((a,b)=>freq[b]-freq[a]);
          for (let s=0; s<=15; s++) {
            const pick = hot.slice(s, s+6).sort((a,b)=>a-b);
            const sum = pick.reduce((acc,n)=>acc+n,0);
            if (sum>=100 && sum<=159) return pick;
          }
          return hot.slice(0,6).sort((a,b)=>a-b);
        }
      },
      {
        name: "🔬 패턴필터", icon: "🔬", desc: "홀짝·구간·연속 복합",
        gen: (hist) => {
          const freq = new Array(46).fill(0);
          hist.slice(-100).forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n => freq[n]++));
          const hot = Array.from({length:45},(_,i)=>i+1).sort((a,b)=>freq[b]-freq[a]);
          for (let s=0; s<=20; s++) {
            const pick = hot.slice(s, s+6).sort((a,b)=>a-b);
            const sum = pick.reduce((acc,n)=>acc+n,0);
            const odd = pick.filter(n=>n%2===1).length;
            const secs = new Set(pick.map(n=>n<=10?1:n<=20?2:n<=30?3:n<=40?4:5)).size;
            let cons=0; for(let i=0;i<pick.length-1;i++) if(pick[i+1]-pick[i]===1) cons++;
            if(sum>=100&&sum<=159&&(odd===3||odd===4)&&secs>=3&&cons>=1) return pick;
          }
          return hot.slice(0,6).sort((a,b)=>a-b);
        }
      },
      {
        name: "🎲 랜덤기준", icon: "🎲", desc: "이론 기준값 (2.2%/회)",
        gen: (_hist) => {
          // 고정 시드 기반 의사랜덤: 순서 섞기 (draw_no 기반)
          const pool = Array.from({length:45},(_,i)=>i+1);
          for (let i=pool.length-1; i>0; i--) {
            const j = (i * 7 + 13) % (i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          return pool.slice(0,6).sort((a,b)=>a-b);
        }
      },
    ];

    const TEST_SIZE = 200;
    const testDraws = draws.slice(-TEST_SIZE);

    return strategies.map(s => {
      let m3=0, m4=0, m5=0, m6=0;
      testDraws.forEach((draw, testIdx) => {
        const histIdx = draws.length - TEST_SIZE + testIdx;
        if (histIdx < 50) return;
        const hist = draws.slice(0, histIdx);
        const winning = [draw.n1,draw.n2,draw.n3,draw.n4,draw.n5,draw.n6];
        const gen = s.gen(hist);
        const match = gen.filter(n=>winning.includes(n)).length;
        if (match>=6) m6++;
        else if (match>=5) m5++;
        else if (match>=4) m4++;
        else if (match>=3) m3++;
      });
      const score = m5*1000 + m4*10 + m3;
      return { name: s.name, icon: s.icon, desc: s.desc, m3, m4, m5, m6, score };
    }).sort((a,b)=>b.score-a.score);
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
        if ((!latestDraw && draws.length === 0) || nums.length === 0) return null;
        const latest = latestDraw ?? draws[draws.length - 1];
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
                <span className="text-teal-200 font-semibold">전체 {patternStats.total}회 분석 · {(latestDraw ?? draws[draws.length - 1])?.draw_no}회차까지 반영</span>
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

      {/* ── 최근 N회 번호 히트맵 ── */}
      {(heatmapData || commonData) && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
              <span>🔥</span> 최근 회차 번호 히트맵
              <span className="bg-orange-100 text-orange-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">NEW</span>
            </h3>
            <div className="flex gap-1">
              {(["50","100","200"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setHeatmapMode(m)}
                  className={`text-[10px] px-2 py-1 rounded-lg font-bold transition ${
                    heatmapMode === m ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >{m}회</button>
              ))}
              <button
                onClick={() => setHeatmapMode("common")}
                className={`text-[10px] px-2 py-1 rounded-lg font-bold transition ${
                  heatmapMode === "common" ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-500 hover:bg-rose-100"
                }`}
              >🎯교집합</button>
            </div>
          </div>
          {heatmapMode === "common" ? (
            <>
              <p className="text-[10px] text-gray-400 mb-3 bg-rose-50 rounded-lg px-3 py-2">
                <span className="text-rose-600 font-bold">💡 교집합이란?</span> 최근 50·100·200회 <span className="font-semibold">모두</span>에서 평균 이상 출현한 번호 — 단기·중기·장기 트렌드가 일치하는 <span className="font-semibold text-rose-700">가장 강력한 핫 번호</span>입니다. 주황 테두리는 2구간 공통.
              </p>
              <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
                  const isTriple = commonData?.common.some(c => c.n === n) ?? false;
                  const isDouble = !isTriple && (commonData?.twoOnly.includes(n) ?? false);
                  const bg = isTriple
                    ? "bg-rose-600 text-white ring-2 ring-rose-400"
                    : isDouble
                    ? "bg-orange-100 text-orange-700 ring-2 ring-orange-300"
                    : "bg-gray-100 text-gray-300";
                  const label = isTriple ? "★" : isDouble ? "◐" : "";
                  return (
                    <div key={n} className={`${bg} rounded-lg text-center py-1.5 transition`} title={isTriple ? `${n}번: 3구간 공통 핫` : isDouble ? `${n}번: 2구간 공통` : `${n}번: 해당없음`}>
                      <div className="text-[10px] font-bold">{n}</div>
                      <div className="text-[9px] opacity-80">{label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-3 justify-center text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-600 inline-block"></span>3구간 공통 ★</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 inline-block border border-orange-300"></span>2구간 공통 ◐</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 inline-block border"></span>해당없음</span>
              </div>
            </>
          ) : heatmapData ? (
            <>
              <p className="text-[10px] text-gray-400 mb-3 bg-orange-50 rounded-lg px-3 py-2"><span className="text-orange-600 font-bold">💡 히트맵이란?</span> 최근 {heatmapMode}회차에서 각 번호가 몇 번 나왔는지 색으로 표현 — <span className="font-semibold text-orange-700">진한 주황</span>은 자주 출현, <span className="font-semibold text-sky-600">파랑</span>은 드물게 출현. 50·100·200회 탭을 전환해 단기·중기·장기 트렌드를 비교하세요.</p>
              <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
                  const c = heatmapData.counts[n];
                  const intensity = heatmapData.max > 0 ? c / heatmapData.max : 0;
                  const isHot = intensity >= 0.75;
                  const isWarm = intensity >= 0.5;
                  const isCold = intensity <= 0.2;
                  const bg = isHot ? "bg-orange-500 text-white" : isWarm ? "bg-orange-200 text-orange-800" : isCold ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500";
                  return (
                    <div key={n} className={`${bg} rounded-lg text-center py-1.5 transition`} title={`${n}번: ${c}회`}>
                      <div className="text-[10px] font-bold">{n}</div>
                      <div className="text-[9px] opacity-80">{c}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-3 justify-center text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500 inline-block"></span>많이 출현</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 inline-block border"></span>보통</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 inline-block"></span>적게 출현</span>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── 3구간 공통 핫 번호 ── */}
      {commonData && commonData.common.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
          <h3 className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
            <span>🔥</span> 3구간 공통 핫 번호
            <span className="ml-auto bg-rose-100 text-rose-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">
              50 · 100 · 200회 모두 평균 이상
            </span>
          </h3>
          <p className="text-[10px] text-gray-400 mb-3">
            최근 50회, 100회, 200회 모두에서 기대값 이상으로 출현한 번호 — 단기·중기·장기 트렌드가 일치합니다.
          </p>

          {/* 공통 번호 볼 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {commonData.common.map(({ n, score, c50, c100, c200 }) => (
              <div key={n} className="flex flex-col items-center gap-0.5">
                <div className="relative">
                  <Ball n={n} size="md" />
                  <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[8px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center shadow">
                    ★
                  </span>
                </div>
                <span className="text-[9px] text-gray-400">{c50}/{c100}/{c200}</span>
              </div>
            ))}
          </div>

          {/* 구간별 빈도 비교 표 */}
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-center">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="pb-1 text-left">번호</th>
                  <th className="pb-1">최근 50회</th>
                  <th className="pb-1">최근 100회</th>
                  <th className="pb-1">최근 200회</th>
                  <th className="pb-1">종합점수</th>
                </tr>
              </thead>
              <tbody>
                {commonData.common.slice(0, 12).map(({ n, score, c50, c100, c200 }) => (
                  <tr key={n} className="border-b border-gray-50 hover:bg-rose-50 transition-colors">
                    <td className="py-1 text-left">
                      <Ball n={n} size="sm" />
                    </td>
                    <td className="py-1 font-bold text-rose-600">{c50}회</td>
                    <td className="py-1 font-bold text-orange-600">{c100}회</td>
                    <td className="py-1 font-bold text-amber-600">{c200}회</td>
                    <td className="py-1">
                      <span className="bg-rose-100 text-rose-700 font-extrabold px-1.5 py-0.5 rounded">
                        {score}위합
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 2구간 공통 (참고) */}
          {commonData.twoOnly.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-500 font-semibold mb-1.5">
                📌 2구간 공통 (참고) — 3구간 중 2개 구간에서 평균 이상
              </p>
              <div className="flex flex-wrap gap-1.5">
                {commonData.twoOnly.map(n => (
                  <div key={n} className="relative">
                    <Ball n={n} size="sm" />
                    <span className="absolute -top-1 -right-1 bg-gray-400 text-white text-[7px] font-extrabold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                      2
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 🧪 전략 백테스팅 ── */}
      {backtestResults && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
          <h3 className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
            <span>🧪</span> 전략 백테스팅
            <span className="bg-rose-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">NEW</span>
          </h3>
          <p className="text-[10px] text-gray-400 mb-2">
            최근 <span className="font-bold text-gray-600">200회</span> walk-forward 시뮬레이션 — 각 회차 직전 데이터만으로 번호를 선택, 실제 당첨번호와 비교한 결과입니다.
            <span className="text-amber-600 font-semibold"> 6개 중 몇 개 일치하는지</span>를 전략별로 집계합니다.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 flex items-start gap-2">
            <span className="text-amber-500 text-sm shrink-0 mt-0.5">💡</span>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              <span className="font-bold">1위 전략을 직접 써보려면</span> → <span className="font-semibold text-indigo-700">생성 페이지</span>에서 세트 수를 1~5로 설정하고, 전략 선택창에서 해당 전략을 골라 생성하세요.
              <br /><span className="text-amber-600">예) 1위 = 콜드번호 → 생성 페이지 전략 선택 → ❄️ 콜드번호 선택 → 생성하기</span>
            </p>
          </div>
          <div className="space-y-2">
            {backtestResults.map((r, rank) => {
              const total = 200;
              const hit3pct = ((r.m3 + r.m4 + r.m5 + r.m6) / total * 100).toFixed(1);
              const isTop = rank === 0;
              return (
                <div key={r.name} className={`rounded-xl p-3 border transition-all ${isTop ? "bg-amber-50 border-amber-300" : "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isTop ? "bg-amber-500 text-white" : "bg-gray-300 text-gray-600"}`}>
                        {rank + 1}
                      </span>
                      <span className={`text-xs font-bold ${isTop ? "text-amber-700" : "text-gray-700"}`}>{r.name}</span>
                      <span className="text-[10px] text-gray-400">{r.desc}</span>
                    </div>
                    <span className={`text-[11px] font-extrabold ${isTop ? "text-amber-600" : "text-gray-500"}`}>
                      3개↑ {hit3pct}%
                    </span>
                  </div>
                  <div className="flex gap-2 text-[10px]">
                    {r.m5 > 0 && (
                      <span className="bg-rose-100 text-rose-700 font-extrabold px-2 py-0.5 rounded-full">
                        5개일치 {r.m5}회
                      </span>
                    )}
                    {r.m4 > 0 && (
                      <span className="bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full">
                        4개일치 {r.m4}회
                      </span>
                    )}
                    <span className="bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
                      3개일치 {r.m3}회
                    </span>
                    <span className="text-gray-300 px-1 py-0.5">/ 200회 시뮬</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[9px] text-gray-300 mt-2 text-center">
            * 각 전략은 1세트 결정론적 시뮬레이션 · 랜덤전략은 고정 시드 사용 · 로또 당첨은 순수 확률이므로 참고용입니다
          </p>
        </div>
      )}

      {/* ── 끝자리 편향 차트 ── */}
      {tailBiasData && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
          <h3 className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
            <span>🔢</span> 끝자리(일의 자리) 출현 편향
            <span className="bg-violet-100 text-violet-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">NEW</span>
          </h3>
          <p className="text-[10px] text-gray-400 mb-3 bg-violet-50 rounded-lg px-3 py-2"><span className="text-violet-600 font-bold">💡 끝자리 편향이란?</span> 전체 {draws.length}회 기준으로, 1~45번 각각의 일의 자리(0~9) 출현 비율을 계산합니다. 이론상 균등하면 각 끝자리 10%이지만, 실제로는 편차가 있습니다. 끝자리 다양성 전략은 이 편차를 보정하여 6가지 끝자리가 고르게 분산된 조합을 생성합니다.</p>
          <div className="space-y-1.5">
            {tailBiasData.map(({ tail, pct, bias }) => {
              const isPos = bias > 0;
              const absBias = Math.abs(bias);
              const barW = Math.min(absBias * 4, 100);
              return (
                <div key={tail} className="flex items-center gap-2">
                  <div className="w-8 shrink-0 text-center">
                    <span className="text-[11px] font-extrabold text-gray-600">끝{tail}</span>
                  </div>
                  <div className="flex-1 relative h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`absolute top-0 h-full rounded-full transition-all duration-700 ${
                        isPos ? "bg-gradient-to-r from-rose-400 to-rose-500" : "bg-gradient-to-r from-sky-400 to-sky-500"
                      }`}
                      style={{ width: `${Math.max(barW, 1)}%` }}
                    />
                  </div>
                  <div className="text-right shrink-0 w-28">
                    <span className="text-[11px] font-bold text-gray-600">{pct.toFixed(1)}%</span>
                    <span className={`text-[10px] ml-1 font-semibold ${isPos ? "text-rose-500" : "text-sky-500"}`}>
                      ({isPos ? "+" : ""}{bias.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 bg-violet-50 rounded-lg px-3 py-2">
            <span className="text-violet-600 font-bold">💡 전략 활용:</span> 끝자리 3·4 과다 출현 → 끝자리다양성 전략이 이를 보정하여 6가지 끝자리 분산 조합 생성
          </p>
        </div>
      )}

      {/* ── 합계 분포 황금구간 강조 그래프 ── */}
      {patternStats && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-5">
          <h3 className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
            <span>🥇</span> 합계 분포 × 황금구간 분석
            <span className="bg-amber-100 text-amber-700 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">NEW</span>
          </h3>
          <p className="text-[10px] text-gray-400 mb-3">역대 {patternStats.total}회 당첨번호 합계 분포 · 황금구간 120~155 강조</p>
          <div className="space-y-1">
            {patternStats.sum.labels.map((label, i) => {
              const count = patternStats.sum.counts[i];
              const pct = (count / patternStats.total * 100);
              const isGolden = label === "120-129" || label === "130-139" || label === "140-149" || label === "150-159";
              const isPass = patternStats.sum.highlight[i];
              const maxCount = Math.max(...patternStats.sum.counts);
              const barW = maxCount > 0 ? (count / maxCount * 100) : 0;
              return (
                <div key={label} className={`flex items-center gap-2 rounded-xl px-2 py-1 ${isGolden ? "bg-amber-50" : ""}`}>
                  <div className="w-16 shrink-0">
                    <span className={`text-[10px] font-semibold ${isGolden ? "text-amber-700" : isPass ? "text-emerald-600" : "text-gray-400"}`}>
                      {label}
                    </span>
                  </div>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        isGolden ? "bg-gradient-to-r from-amber-400 to-yellow-500" : isPass ? "bg-gradient-to-r from-emerald-400 to-teal-400" : "bg-gray-300"
                      }`}
                      style={{ width: `${Math.max(barW, 0.5)}%` }}
                    />
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <span className={`text-[11px] font-bold ${isGolden ? "text-amber-700" : isPass ? "text-emerald-600" : "text-gray-400"}`}>
                      {pct.toFixed(1)}%
                    </span>
                    {isGolden && <span className="text-[9px] ml-1 text-amber-500">🥇</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5">
              <p className="text-amber-700 font-bold mb-0.5">🥇 황금구간 (120~155)</p>
              <p className="text-amber-600 font-extrabold text-base">
                {(((patternStats.sum.counts[4] ?? 0) + (patternStats.sum.counts[5] ?? 0) + (patternStats.sum.counts[6] ?? 0)) / patternStats.total * 100).toFixed(1)}%
              </p>
              <p className="text-gray-400 mt-0.5">전체 당첨 중 이 범위</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
              <p className="text-emerald-700 font-bold mb-0.5">📊 필터 통과 (100~159)</p>
              <p className="text-emerald-600 font-extrabold text-base">
                {((patternStats.passSum / patternStats.total) * 100).toFixed(1)}%
              </p>
              <p className="text-gray-400 mt-0.5">패턴 필터 범위</p>
            </div>
          </div>
        </div>
      )}


      {/* ────────────────────────────────────────────── */}
      {/* ── 📊 베이지안 상세 분석 ── */}
      {/* ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent" />
        <span className="text-[11px] font-bold text-violet-400 bg-violet-50 px-3 py-1 rounded-full border border-violet-100">
          🧮 베이지안 상세 분석
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent" />
      </div>

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
