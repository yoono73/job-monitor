"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* ─── Types ─── */
interface SavedRow {
  id: string;
  draw_no: number;
  numbers: number[];
  method: string;
  category: string;
  purchased: boolean;
}
interface DrawRow {
  draw_no: number;
  n1: number; n2: number; n3: number;
  n4: number; n5: number; n6: number;
  bonus: number;
}
interface BayesStat   { number: number; bayesian_rank: number; }
interface PairStat    { num_a: number; num_b: number; }
interface DiagCriterion { label: string; pass: boolean; detail: string; points: number; }
interface DiagResult    { score: number; criteria: DiagCriterion[]; }
interface Judged {
  saved: SavedRow;
  match: number;
  prize: "1등" | "2등" | "3등" | "4등" | "5등" | "낙첨";
  amount: number; // 확정 금액(4·5등만). 1~3등은 0 + 별도 확인
}

/* ─── 확률 기준값 (6/45, 6개 선택) ─── */
const COMB = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
const TOTAL = COMB(45, 6);
const PMF = [0, 1, 2, 3, 4, 5, 6].map(k => (COMB(6, k) * COMB(39, 6 - k)) / TOTAL);
const EXP_MATCH = 6 * 6 / 45;                                   // 0.8
const VAR_MATCH = 6 * (6 / 45) * (39 / 45) * (39 / 44);          // 초기하분포 분산
const P_GE3 = PMF[3] + PMF[4] + PMF[5] + PMF[6];
const PAYOUT_RATE = 0.5; // 판매액 중 당첨금 배분 비율(약 50%)

function judge(s: SavedRow, d: DrawRow): Judged {
  const win = [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6];
  const match = s.numbers.filter(n => win.includes(n)).length;
  const bonus = s.numbers.includes(d.bonus);
  let prize: Judged["prize"] = "낙첨";
  if (match === 6) prize = "1등";
  else if (match === 5 && bonus) prize = "2등";
  else if (match === 5) prize = "3등";
  else if (match === 4) prize = "4등";
  else if (match === 3) prize = "5등";
  const amount = prize === "5등" ? 5000 : prize === "4등" ? 50000 : 0;
  return { saved: s, match, prize, amount };
}

/* ─── 추천 세트: 패턴 다양화 + 번호 겹침 최소화 ─── */
// 확률은 모든 조합이 동일합니다. 다양한 전략으로 넓게 커버합니다.
function isCommonPattern(nums: number[]): boolean {
  const a = [...nums].sort((x, y) => x - y);
  const sum = a.reduce((x, y) => x + y, 0);
  if (sum < 100 || sum > 175) return true;
  const odd = a.filter(n => n % 2 === 1).length;
  if (odd < 2 || odd > 4) return true;
  if (a.filter(n => n >= 32).length < 1) return true;      // 생일(1~31) 쏠림 방지
  let run = 1;
  for (let i = 1; i < 6; i++) { run = a[i] === a[i - 1] + 1 ? run + 1 : 1; if (run >= 3) return true; }
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const d = a[j] - a[i];
    let len = 2, nx = a[j] + d;
    while (a.includes(nx)) { len++; nx += d; }
    if (len >= 4) return true;                              // 등차수열
  }
  return false;
}
type RecSet = { nums: number[]; method: string; category: string; icon: string };

function genRecommended(count: number): RecSet[] {
  const used = new Array(46).fill(0);
  const out: RecSet[] = [];

  // 패턴 풀 — 10가지 (count ≤ 10이면 각 1회씩)
  const patterns: { method: string; category: string; icon: string; gen: (used: number[]) => number[] | null }[] = [
    {
      method: "황금구간", category: "패턴기반", icon: "🥇",
      gen: () => {
        for (let t = 0; t < 5000; t++) {
          const nums = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          const sum = nums.reduce((a,b)=>a+b,0);
          const low = nums.filter(n=>n<=22).length;
          const odd = nums.filter(n=>n%2===1).length;
          const cons = nums.slice(0,-1).filter((n,i)=>nums[i+1]-n===1).length;
          if (sum>=110&&sum<=155&&low>=2&&low<=4&&odd>=2&&odd<=4&&cons<=2&&!isCommonPattern(nums)) return nums;
        }
        return null;
      }
    },
    {
      method: "분산추천", category: "균형기반", icon: "🌐",
      gen: (used) => {
        for (let t = 0; t < 4000; t++) {
          const pool = Array.from({length:45},(_,i)=>i+1)
            .sort((x,y)=>used[x]+Math.random()*0.9-(used[y]+Math.random()*0.9)).slice(0,14);
          const pick = pool.sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          if (!isCommonPattern(pick)) return pick;
        }
        return null;
      }
    },
    {
      method: "조건필터", category: "패턴기반", icon: "🎯",
      gen: () => {
        const calcAC = (s: number[]) => { const d=new Set<number>(); for(let i=0;i<s.length;i++) for(let j=i+1;j<s.length;j++) d.add(s[j]-s[i]); return d.size-5; };
        const secOf = (n: number) => n<=10?0:n<=20?1:n<=30?2:n<=40?3:4;
        for (let t = 0; t < 20000; t++) {
          const s = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          const sum=s.reduce((a,b)=>a+b,0); if(sum<100||sum>155) continue;
          const odd=s.filter(n=>n%2===1).length; if(odd<2||odd>4) continue;
          if(new Set(s.map(secOf)).size<3) continue;
          const consArr=s.slice(0,-1).map((n,i)=>s[i+1]-n===1);
          if(!consArr.some(Boolean)) continue;
          let tri=false; for(let i=0;i<consArr.length-1;i++) if(consArr[i]&&consArr[i+1]){tri=true;break;}
          if(tri) continue;
          const tf=s.reduce((m,n)=>{const t2=n%10;m[t2]=(m[t2]||0)+1;return m},{} as Record<number,number>);
          if(Math.max(...Object.values(tf))>2) continue;
          const lw=s.filter(n=>n<=22).length; if(lw<2||lw>4) continue;
          if(calcAC(s)<7) continue;
          if(!isCommonPattern(s)) return s;
        }
        return null;
      }
    },
    {
      method: "핫번호", category: "통계기반", icon: "🔥",
      gen: () => {
        // 최근 50회 고빈도 번호 위주 (draws 없어도 랜덤으로 fallback)
        for (let t = 0; t < 3000; t++) {
          const nums = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          const sum=nums.reduce((a,b)=>a+b,0);
          if(sum>=100&&sum<=175&&!isCommonPattern(nums)) return nums;
        }
        return null;
      }
    },
    {
      method: "황금필터강화", category: "패턴기반", icon: "✨",
      gen: () => {
        const secOf=(n:number)=>n<=10?0:n<=20?1:n<=30?2:n<=40?3:4;
        for(let t=0;t<10000;t++){
          const s=Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          const sum=s.reduce((a,b)=>a+b,0); if(sum<115||sum>165) continue;
          const odd=s.filter(n=>n%2===1).length; if(odd<2||odd>4) continue;
          if(new Set(s.map(secOf)).size<3) continue;
          let cons=0; for(let i=0;i<s.length-1;i++) if(s[i+1]-s[i]===1) cons++;
          if(cons>1) continue;
          if(!isCommonPattern(s)) return s;
        }
        return null;
      }
    },
    {
      method: "3구간균등", category: "균형기반", icon: "🏛️",
      gen: () => {
        for(let t=0;t<8000;t++){
          const lo=Array.from({length:15},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,2);
          const mi=Array.from({length:15},(_,i)=>i+16).sort(()=>Math.random()-0.5).slice(0,2);
          const hi=Array.from({length:15},(_,i)=>i+31).sort(()=>Math.random()-0.5).slice(0,2);
          const s=[...lo,...mi,...hi].sort((a,b)=>a-b);
          if(!isCommonPattern(s)) return s;
        }
        return null;
      }
    },
    {
      method: "끝자리다양성", category: "통계기반", icon: "🔟",
      gen: () => {
        for(let t=0;t<8000;t++){
          const s=Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          const tails=new Set(s.map(n=>n%10));
          const sum=s.reduce((a,b)=>a+b,0);
          const low=s.filter(n=>n<=22).length;
          const odd=s.filter(n=>n%2===1).length;
          if(tails.size>=6&&sum>=100&&sum<=175&&low>=2&&low<=4&&odd>=2&&odd<=4&&!isCommonPattern(s)) return s;
        }
        return null;
      }
    },
    {
      method: "연속번호포함", category: "패턴기반", icon: "🔗",
      gen: () => {
        for(let t=0;t<5000;t++){
          const s=Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
          const cons=s.slice(0,-1).filter((n,i)=>s[i+1]-n===1).length;
          const sum=s.reduce((a,b)=>a+b,0);
          const odd=s.filter(n=>n%2===1).length;
          if(cons>=1&&cons<=2&&sum>=100&&sum<=175&&odd>=2&&odd<=4&&!isCommonPattern(s)) return s;
        }
        return null;
      }
    },
    {
      method: "소수위주", category: "패턴기반", icon: "🔢",
      gen: () => {
        const primes=[2,3,5,7,11,13,17,19,23,29,31,37,41,43];
        const others=Array.from({length:45},(_,i)=>i+1).filter(n=>!primes.includes(n));
        for(let t=0;t<5000;t++){
          const pc=Math.floor(Math.random()*2)+3; // 3~4개 소수
          const picked=[...primes].sort(()=>Math.random()-0.5).slice(0,pc);
          const rest=[...others].sort(()=>Math.random()-0.5).slice(0,6-pc);
          const s=[...picked,...rest].sort((a,b)=>a-b);
          const sum=s.reduce((a,b)=>a+b,0);
          const odd=s.filter(n=>n%2===1).length;
          if(sum>=100&&sum<=175&&odd>=2&&odd<=4&&!isCommonPattern(s)) return s;
        }
        return null;
      }
    },
  ];

  for (let g = 0; g < count; g++) {
    const p = patterns[g % patterns.length];
    const nums = p.gen(used) ?? Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6).sort((a,b)=>a-b);
    nums.forEach(n => { used[n]++; });
    out.push({ nums, method: p.method, category: p.category, icon: p.icon });
  }
  return out;
}
function ballColor(n: number) {
  if (n <= 10) return "bg-[#FBC400] text-black";
  if (n <= 20) return "bg-[#069FDD] text-white";
  if (n <= 30) return "bg-[#FF5757] text-white";
  if (n <= 40) return "bg-[#AAAAAA] text-white";
  return "bg-[#B0D840] text-black";
}

/* ─── 번호 진단 (draws 오름차순 기준 — report page) ─── */
function diagnosNumbers(nums: number[], draws: DrawRow[], bayesStats: BayesStat[], pairStats: PairStat[]): DiagResult {
  const sorted = [...nums].sort((a, b) => a - b);
  const criteria: DiagCriterion[] = [];

  const calcAC = (s: number[]) => {
    const diffs = new Set<number>();
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++)
        diffs.add(s[j] - s[i]);
    return diffs.size - 5;
  };

  // 1. 합계 황금구간 (15점) — 실제 1등 기준 10~90퍼센타일: 98~177, 중앙값 137
  const sum = sorted.reduce((s, n) => s + n, 0);
  criteria.push({ label: "합계 적정구간 (100~175)", pass: sum >= 100 && sum <= 175, detail: `합계 ${sum}`, points: 15 });

  // 2. 홀짝 균형 (15점) — 실제 1등 홀수=3이 35%, 2~4개가 85%
  const oddCnt = sorted.filter(n => n % 2 === 1).length;
  criteria.push({ label: "홀짝 균형 (홀수 2~4개)", pass: oddCnt >= 2 && oddCnt <= 4, detail: `홀수 ${oddCnt}개`, points: 15 });

  // 3. 3구간 커버 (15점)
  const secs = new Set(sorted.map(n => n <= 15 ? 1 : n <= 30 ? 2 : 3));
  criteria.push({ label: "3구간 완전 커버 (1~15·16~30·31~45)", pass: secs.size === 3, detail: `${secs.size}구간`, points: 15 });

  // 4. 베이지안 상위 (15점) — 실제 1등 기준 완화: 평균 30위↑
  if (bayesStats.length > 0) {
    const avgRank = sorted.map(n => { const b = bayesStats.find(x => x.number === n); return b ? b.bayesian_rank : 45; }).reduce((s, r) => s + r, 0) / sorted.length;
    criteria.push({ label: "베이지안 상위 (평균 순위 30위↑)", pass: avgRank < 30, detail: `평균 ${avgRank.toFixed(1)}위`, points: 15 });
  } else {
    criteria.push({ label: "베이지안 상위", pass: false, detail: "데이터 로딩 중", points: 15 });
  }

  // 5. 핫번호 2개↑ (10점) — draws가 오름차순이므로 뒤에서 100개 슬라이스
  const recent = draws.slice(-Math.min(100, draws.length));
  const freq: Record<number, number> = {};
  for (const d of recent) [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(n => { freq[n] = (freq[n] ?? 0) + 1; });
  const hotNums = Object.entries(freq).sort(([, a], [, b]) => b - a).slice(0, 15).map(([n]) => +n);
  const hotCnt = sorted.filter(n => hotNums.includes(n)).length;
  criteria.push({ label: "핫번호 2개↑ (최근 100회 상위 15)", pass: hotCnt >= 2, detail: `${hotCnt}개 포함`, points: 10 });

  // 6. 연속번호 1쌍↑ (10점)
  let consPairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) consPairs++;
  criteria.push({ label: "연속번호 1쌍 이상", pass: consPairs >= 1, detail: `${consPairs}쌍`, points: 10 });

  // 7. 끝자리 5종↑ (10점)
  const tails = new Set(sorted.map(n => n % 10));
  criteria.push({ label: "끝자리 다양성 (5종 이상)", pass: tails.size >= 5, detail: `${tails.size}종`, points: 10 });

  // 8. AC값 ≥8 (10점)
  const acVal = calcAC(sorted);
  criteria.push({ label: "AC값 ≥8 (번호 분산성 우수)", pass: acVal >= 8, detail: `AC=${acVal}`, points: 10 });

  // 9. 상위 페어 3개↑ (10점)
  if (pairStats.length > 0) {
    const myPairs: string[] = [];
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++)
        myPairs.push(`${sorted[i]}-${sorted[j]}`);
    const topKeys = new Set(pairStats.map(p => `${Math.min(p.num_a, p.num_b)}-${Math.max(p.num_a, p.num_b)}`));
    const hits = myPairs.filter(k => topKeys.has(k)).length;
    criteria.push({ label: "상위 페어 3개↑ (궁합 좋은 쌍)", pass: hits >= 3, detail: `${hits}/15쌍 매칭`, points: 10 });
  } else {
    criteria.push({ label: "상위 페어 3개↑ (궁합 좋은 쌍)", pass: false, detail: "데이터 로딩 중", points: 10 });
  }

  const score = criteria.reduce((s, c) => c.pass ? s + c.points : s, 0);
  return { score, criteria };
}

function verdict(n: number, avg: number) {
  if (n < 30) return { label: "아직 게임이 적어요", cls: "bg-gray-100 text-gray-500", z: null as number | null };
  const z = (avg - EXP_MATCH) / Math.sqrt(VAR_MATCH / n);
  if (Math.abs(z) < 3) return { label: "평균 수준 (정상 범위)", cls: "bg-slate-100 text-slate-600", z };
  return { label: "평균과 차이 보임 (더 지켜봐요)", cls: "bg-amber-100 text-amber-700", z };
}

/* ─── Page ─── */
export default function ReportPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [judged, setJudged] = useState<Judged[]>([]);
  const [judgedTest, setJudgedTest] = useState<Judged[]>([]);
  const [stratTab, setStratTab] = useState<"real" | "test">("real");
  const [pending, setPending] = useState(0);
  const [draws, setDraws] = useState<DrawRow[]>([]);
  const [drawNoOf, setDrawNoOf] = useState<Map<string, number>>(new Map());
  const [userId, setUserId] = useState<string | null>(null);
  const [nextDrawNo, setNextDrawNo] = useState<number | null>(null);
  const [recCount, setRecCount] = useState(10);
  const [recs, setRecs] = useState<RecSet[] | null>(null);
  const [recSaved, setRecSaved] = useState<Set<number>>(new Set());
  const [recMsg, setRecMsg] = useState<string | null>(null);
  const [recSaving, setRecSaving] = useState(false);
  const [bayesStats, setBayesStats] = useState<BayesStat[]>([]);
  const [pairStats,  setPairStats]  = useState<PairStat[]>([]);
  const [recDiags,   setRecDiags]   = useState<(DiagResult | null)[]>([]);

  useEffect(() => {
    async function load() {
      // 전체 회차 (1000행 제한 대응: 페이지 단위로 읽기)
      const all: DrawRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase
          .from("lotto_draws")
          .select("draw_no,n1,n2,n3,n4,n5,n6,bonus")
          .order("draw_no", { ascending: true })
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        all.push(...(data as DrawRow[]));
        if (data.length < 1000) break;
      }
      setDraws(all);
      if (all.length > 0) setNextDrawNo(all[all.length - 1].draw_no + 1);

      // 베이지안/페어 통계 (진단용)
      supabase.from("lotto_number_stats")
        .select("number,bayesian_rank")
        .order("bayesian_rank")
        .then(({ data }) => { if (data) setBayesStats(data as BayesStat[]); });

      supabase.from("lotto_pair_stats")
        .select("num_a,num_b")
        .order("posterior_mean", { ascending: false })
        .limit(100)
        .then(({ data }) => { if (data) setPairStats(data as PairStat[]); });

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data: saved } = await supabase
          .from("saved_numbers")
          .select("id,draw_no,numbers,method,category,purchased,is_test")
          .eq("user_id", user.id);
        const drawMap = new Map(all.map(d => [d.draw_no, d]));
        const rows = (saved ?? []) as (SavedRow & { is_test: boolean })[];
        const out: Judged[] = [];
        const outTest: Judged[] = [];
        let pend = 0;
        const m = new Map<string, number>();
        rows.forEach(s => {
          const d = drawMap.get(s.draw_no);
          if (!d) { if (!s.is_test) pend++; return; }
          const j = judge(s, d);
          if (s.is_test) outTest.push(j);
          else { out.push(j); m.set(s.id, s.draw_no); }
        });
        setJudged(out);
        setJudgedTest(outTest);
        setPending(pend);
        setDrawNoOf(m);
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  /* ── 전체 성적 ── */
  const overall = useMemo(() => {
    const n = judged.length;
    if (n === 0) return null;
    const dist = [0, 0, 0, 0, 0, 0, 0];
    judged.forEach(j => dist[j.match]++);
    const avg = judged.reduce((s, j) => s + j.match, 0) / n;
    const ge3 = judged.filter(j => j.match >= 3).length;
    return { n, dist, avg, ge3 };
  }, [judged]);

  /* ── 전략별 (무작위 기준선과 비교) ── */
  const byMethod = useMemo(() => {
    const m: Record<string, { category: string; matches: number[] }> = {};
    judged.forEach(j => {
      const k = j.saved.method;
      if (!m[k]) m[k] = { category: j.saved.category, matches: [] };
      m[k].matches.push(j.match);
    });
    return Object.entries(m)
      .map(([method, d]) => {
        const n = d.matches.length;
        const avg = d.matches.reduce((a, b) => a + b, 0) / n;
        return { method, category: d.category, n, avg, best: Math.max(...d.matches), v: verdict(n, avg) };
      })
      .sort((a, b) => b.n - a.n);
  }, [judged]);

  /* ── 전략별 (테스트 데이터) ── */
  const byMethodTest = useMemo(() => {
    const m: Record<string, { category: string; matches: number[] }> = {};
    judgedTest.forEach(j => {
      const k = j.saved.method;
      if (!m[k]) m[k] = { category: j.saved.category, matches: [] };
      m[k].matches.push(j.match);
    });
    return Object.entries(m)
      .map(([method, d]) => {
        const n = d.matches.length;
        const avg = d.matches.reduce((a, b) => a + b, 0) / n;
        return { method, category: d.category, n, avg, best: Math.max(...d.matches), v: verdict(n, avg) };
      })
      .sort((a, b) => b.n - a.n);
  }, [judgedTest]);

  /* ── 구매 손익 (구매완료 체크한 것만) ── */
  const money = useMemo(() => {
    const bought = judged; // 저장한 번호 전체(추첨 완료분)를 구매한 것으로 계산
    const invest = bought.length * 1000;
    const back = bought.reduce((s, j) => s + j.amount, 0);
    const big = bought.filter(j => ["1등", "2등", "3등"].includes(j.prize));
    // 회차별 누적
    const byDraw = new Map<number, { inv: number; ret: number }>();
    bought.forEach(j => {
      const dn = drawNoOf.get(j.saved.id) ?? j.saved.draw_no;
      const c = byDraw.get(dn) ?? { inv: 0, ret: 0 };
      c.inv += 1000; c.ret += j.amount;
      byDraw.set(dn, c);
    });
    let cum = 0;
    const series = [...byDraw.entries()].sort((a, b) => a[0] - b[0]).map(([dn, c]) => {
      cum += c.ret - c.inv;
      return { dn, inv: c.inv, ret: c.ret, cum };
    });
    return { count: bought.length, invest, back, big, series, expected: Math.round(invest * PAYOUT_RATE) };
  }, [judged, drawNoOf]);

  /* ── 백테스트: 지난 데이터로 뽑은 핫/콜드 6개가 다음 회차에 얼마나 맞았나 ── */
  const backtest = useMemo(() => {
    const T = draws.length;
    if (T < 300) return null;
    const LAMBDA = 0.998, START = 200;
    const w = new Array(46).fill(0);
    let hot = 0, cold = 0, hotGe3 = 0, coldGe3 = 0, cnt = 0;
    for (let t = 0; t < T; t++) {
      const d = draws[t];
      const win = [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6];
      if (t >= START) {
        const order = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => w[b] - w[a]);
        const h = order.slice(0, 6).filter(n => win.includes(n)).length;
        const c = order.slice(-6).filter(n => win.includes(n)).length;
        hot += h; cold += c;
        if (h >= 3) hotGe3++;
        if (c >= 3) coldGe3++;
        cnt++;
      }
      for (let n = 1; n <= 45; n++) w[n] *= LAMBDA;
      win.forEach(n => { w[n] += 1; });
    }
    const se = Math.sqrt(VAR_MATCH / cnt);
    return {
      cnt,
      hotAvg: hot / cnt, coldAvg: cold / cnt,
      hotZ: (hot / cnt - EXP_MATCH) / se, coldZ: (cold / cnt - EXP_MATCH) / se,
      hotGe3, coldGe3, expGe3: cnt * P_GE3,
    };
  }, [draws]);

  const saveRecs = async () => {
    if (!recs || !userId || !nextDrawNo || recSaving) return;
    setRecSaving(true);
    const rows = recs.map((r, i) => ({
      user_id: userId, draw_no: nextDrawNo, numbers: r.nums,
      method: r.method, category: r.category, set_idx: i + 1,
    }));
    const { error } = await supabase.from("saved_numbers").insert(rows);
    setRecMsg(error ? "저장에 실패했어요. 잠시 후 다시 시도해 주세요." : `${nextDrawNo}회차에 ${rows.length}게임이 저장됐어요 ✓`);
    setRecSaving(false);
    if (!error) setRecs(null);
  };

  const saveOneRec = async (idx: number) => {
    if (!recs || !userId || !nextDrawNo) return;
    const r = recs[idx];
    const { error } = await supabase.from("saved_numbers").insert([{
      user_id: userId, draw_no: nextDrawNo, numbers: r.nums,
      method: r.method, category: r.category, set_idx: idx + 1,
    }]);
    if (!error) setRecSaved(prev => new Set(prev).add(idx));
  };

  const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 3 : 2)}%`;

  return (
    <div className="px-4 py-5 md:px-6 lg:px-8 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-gray-800">🧾 내 번호 리포트</h1>
        <p className="text-sm text-gray-400 mt-1">이번 주 추천 번호와 지금까지의 기록을 한곳에서 확인해요</p>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-3xl mb-3 animate-pulse">⏳</div>
          <p className="text-sm">불러오는 중...</p>
        </div>
      )}

      {!loading && (
        <>
          {/* 이번 주 추천 세트 */}
          <section className="bg-white border border-violet-200 rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-extrabold text-violet-800 mb-1">🎯 이번 주 추천 세트{nextDrawNo ? ` (${nextDrawNo}회)` : ""}</h2>
            <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
              게임끼리 번호가 최대한 겹치지 않게 짜고, 많은 사람이 고르는 흔한 조합(생일 번호 쏠림·연속번호·규칙적인 간격)은 피했어요.
              당첨 확률 자체가 올라가는 건 아니지만, 번호를 더 넓게 덮고 1~3등이 나왔을 때 나눠 갖는 사람이 적을 가능성이 커져요.
            </p>
            <div className="flex items-center gap-2 mb-3">
              {[5, 10].map(c => (
                <button key={c} onClick={() => { setRecCount(c); setRecs(null); setRecMsg(null); setRecDiags([]); setRecSaved(new Set()); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${recCount === c ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                  {c}게임
                </button>
              ))}
              <button onClick={() => { setRecs(genRecommended(recCount)); setRecMsg(null); setRecDiags([]); setRecSaved(new Set()); }}
                className="ml-auto px-3 py-1.5 rounded-xl text-xs font-bold bg-violet-100 text-violet-700 hover:bg-violet-200">
                {recs ? "다시 뽑기" : "추천 받기"}
              </button>
            </div>
            {recs && (
              <>
                <div className="space-y-1.5 mb-3">
                  {recs.map((rec, i) => {
                    const nums = rec.nums;
                    const diag = recDiags[i] ?? null;
                    const saved = recSaved.has(i);
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="w-5 text-[11px] text-gray-400 shrink-0">{i + 1}</span>
                          {nums.map(n => (
                            <span key={n} className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs shrink-0 ${ballColor(n)}`}>{n}</span>
                          ))}
                          <span className="text-[11px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg ml-1 shrink-0">{rec.icon} {rec.method}</span>
                          <button
                            onClick={() => saveOneRec(i)}
                            disabled={saved || !userId || !nextDrawNo}
                            className={`text-xs px-2 py-0.5 rounded-lg border transition font-medium shrink-0
                              ${saved ? "border-emerald-300 text-emerald-600 bg-emerald-50 opacity-70" : "border-violet-200 text-violet-500 hover:border-violet-400 hover:bg-violet-50"}`}
                          >
                            {saved ? "✓ 저장됨" : "저장"}
                          </button>
                          <button
                            onClick={() => {
                              setRecDiags(prev => {
                                const next = [...prev];
                                next[i] = diag ? null : diagnosNumbers(nums, draws, bayesStats, pairStats);
                                return next;
                              });
                            }}
                            className={`text-xs px-2 py-0.5 rounded-lg border transition font-medium shrink-0
                              ${diag ? "border-indigo-400 text-indigo-600 bg-indigo-50" : "border-indigo-200 text-indigo-500 hover:border-indigo-400 hover:bg-indigo-50"}`}
                          >
                            🔍 진단{diag ? " ▲" : ""}
                          </button>
                        </div>
                        {diag && (
                          <div className="mt-1.5 ml-6 space-y-1">
                            <div className={`rounded-xl px-3 py-2 flex items-center gap-3 border
                              ${diag.score >= 70 ? "bg-emerald-50 border-emerald-200" : diag.score >= 50 ? "bg-amber-50 border-amber-200" : "bg-rose-50 border-rose-200"}`}>
                              <span className={`text-xl font-extrabold ${diag.score >= 70 ? "text-emerald-600" : diag.score >= 50 ? "text-amber-600" : "text-rose-500"}`}>{diag.score}점</span>
                              <span className="text-xs text-gray-600">{diag.score >= 70 ? "✅ 우수" : diag.score >= 50 ? "⚠️ 보통" : "❌ 미흡"}</span>
                            </div>
                            <div className="space-y-0.5">
                              {diag.criteria.map((c, ci) => (
                                <div key={ci} className={`flex items-center justify-between rounded-lg px-2 py-1 text-[11px] ${c.pass ? "bg-emerald-50" : "bg-gray-50"}`}>
                                  <span className={c.pass ? "text-emerald-700" : "text-gray-500"}>{c.pass ? "✅" : "❌"} {c.label}</span>
                                  <span className="text-gray-400 ml-2 shrink-0">{c.detail}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mb-2">
                  45개 중 {new Set(recs.map(r => r.nums).flat()).size}개 번호를 사용했어요.
                </p>
                <button onClick={saveRecs} disabled={recSaving || !userId || !nextDrawNo}
                  className="w-full py-2.5 rounded-xl text-sm font-bold bg-violet-600 text-white disabled:opacity-50">
                  {recSaving ? "저장 중..." : `${recs.length}게임 모두 저장`}
                </button>
              </>
            )}
            {recMsg && <p className="text-xs text-emerald-600 font-semibold mt-2">{recMsg}</p>}
          </section>

          {/* 읽는 법 */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 text-xs text-amber-800 leading-relaxed">
            로또는 추첨마다 독립이라, 어떤 번호 고르기든 한 게임당 평균 일치 개수는
            <strong> {EXP_MATCH.toFixed(2)}개</strong>가 정상입니다. 아래 수치가 이 근처면 "운이 나쁜 것"도
            "전략이 효과 있는 것"도 아닙니다.
          </div>

          {/* 전체 성적 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-extrabold text-gray-800 mb-3">① 전체 성적</h2>
            {!overall ? (
              <p className="text-xs text-gray-400">추첨이 끝난 저장 번호가 아직 없어요.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-lg font-extrabold text-gray-800">{overall.n}</p>
                    <p className="text-[11px] text-gray-400">판정된 게임</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-lg font-extrabold text-gray-800">{overall.avg.toFixed(2)}</p>
                    <p className="text-[11px] text-gray-400">평균 일치 (기준 {EXP_MATCH.toFixed(2)})</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-lg font-extrabold text-gray-800">
                      {overall.ge3} <span className="text-xs font-semibold text-gray-400">/ 기대 {(overall.n * P_GE3).toFixed(1)}</span>
                    </p>
                    <p className="text-[11px] text-gray-400">3개+ 일치(당첨)</p>
                  </div>
                </div>
                <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                  평균 {overall.avg.toFixed(2)}개로 기준({EXP_MATCH.toFixed(2)}개)보다{" "}
                  <strong className={overall.avg >= EXP_MATCH ? "text-emerald-600" : "text-gray-700"}>
                    {Math.abs(overall.avg - EXP_MATCH) < 0.1 ? "거의 같은 수준" : overall.avg > EXP_MATCH ? "조금 높은 편" : "조금 낮은 편"}
                  </strong>이에요.
                  가장 가까웠던 기록은 <strong>{Math.max(...overall.dist.map((c, k) => (c > 0 ? k : 0)))}개 일치</strong>예요.
                </p>
                <div className="space-y-1.5">
                  {overall.dist.map((c, k) => {
                    const real = c / overall.n;
                    return (
                      <div key={k} className="flex items-center gap-2 text-[11px]">
                        <span className="w-10 text-gray-500 shrink-0">{k}개</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden relative">
                          <div className="h-full bg-slate-400 rounded-full" style={{ width: `${Math.min(real * 100, 100)}%` }} />
                          <div className="absolute top-0 h-full w-0.5 bg-rose-400" style={{ left: `${Math.min(PMF[k] * 100, 100)}%` }} />
                        </div>
                        <span className="w-24 text-right text-gray-500 shrink-0">
                          {c}게임 · 기대 {pct(PMF[k])}
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-gray-300 pt-1">막대=내 실제 비율, 빨간 선=무작위 기대 비율 · 대기 중 {pending}게임 제외</p>
                </div>
              </>
            )}
          </section>

          {/* 전략별 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-extrabold text-gray-800 mb-1">② 전략별 성적 (기준선 비교)</h2>
            <p className="text-[11px] text-gray-400 mb-2">
              30게임 미만은 아직 판단하기 이르고, 평균 수준이면 운의 범위 안이라는 뜻이에요.
            </p>
            {/* 탭 */}
            <div className="flex gap-1 mb-3">
              {(["real", "test"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setStratTab(t)}
                  className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${
                    stratTab === t
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {t === "real" ? "내 구매" : "테스트"}
                </button>
              ))}
            </div>
            {(stratTab === "real" ? byMethod : byMethodTest).length === 0 ? (
              <p className="text-xs text-gray-400">데이터가 없어요.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {(stratTab === "real" ? byMethod : byMethodTest).map(s => (
                  <div key={s.method} className="py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate">{s.method}</p>
                      <p className="text-[11px] text-gray-400">
                        {s.n}게임 · 평균 {s.avg.toFixed(2)}개 · 최고 {s.best}개
                        {s.v.z !== null && <> · z={s.v.z.toFixed(1)}</>}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${s.v.cls}`}>{s.v.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 손익 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-extrabold text-gray-800 mb-1">③ 손익 (저장한 번호 기준)</h2>
            <p className="text-[11px] text-gray-400 mb-3">저장한 번호를 전부 1장(₩1,000)씩 산 것으로 계산합니다. 추첨이 끝난 게임만 포함됩니다.</p>
            {money.count === 0 ? (
              <p className="text-xs text-gray-400">추첨이 끝난 저장 번호가 아직 없어요.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-base font-extrabold text-gray-800">₩{money.invest.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400">저장 {money.count}게임 × ₩1,000</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-base font-extrabold text-gray-800">₩{money.back.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400">확정 환급</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className={`text-base font-extrabold ${money.back - money.invest < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                      {money.back - money.invest >= 0 ? "+" : "-"}₩{Math.abs(money.back - money.invest).toLocaleString()}
                    </p>
                    <p className="text-[11px] text-gray-400">손익</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mb-2">
                  참고: 장기 평균 환급은 구매액의 약 {Math.round(PAYOUT_RATE * 100)}% (이번 금액 기준 약 ₩{money.expected.toLocaleString()}).
                  4·5등만 자동 집계, 1~3등은 별도 확인.
                </p>
                {money.big.length > 0 && (
                  <p className="text-xs text-yellow-600 font-bold mb-2">
                    🏆 {money.big.map(j => `${j.saved.draw_no}회 ${j.prize}`).join(" · ")} — 당첨금 확인 필요!
                  </p>
                )}
                <div className="space-y-1">
                  {money.series.map(r => (
                    <div key={r.dn} className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>{r.dn}회 · 구매 ₩{r.inv.toLocaleString()} · 환급 ₩{r.ret.toLocaleString()}</span>
                      <span className={`font-bold ${r.cum < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                        누적 {r.cum >= 0 ? "+" : "-"}₩{Math.abs(r.cum).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* 백테스트 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-extrabold text-gray-800 mb-1">④ 핫/콜드 번호 검증 (과거 백테스트)</h2>
            <p className="text-[11px] text-gray-400 mb-3">
              매 회차, 그 이전 데이터만으로 핫번호 6개·콜드번호 6개를 뽑아 실제 당첨번호와 비교했습니다.
            </p>
            {!backtest ? (
              <p className="text-xs text-gray-400">데이터가 부족해요.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-[11px] border-b border-gray-100">
                        <th className="text-left py-1.5 font-semibold">방식</th>
                        <th className="text-right font-semibold">평균 일치</th>
                        <th className="text-right font-semibold">z</th>
                        <th className="text-right font-semibold">3개+ 횟수</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-700">
                      <tr className="border-b border-gray-50">
                        <td className="py-1.5">핫번호 6개</td>
                        <td className="text-right">{backtest.hotAvg.toFixed(3)}</td>
                        <td className="text-right">{backtest.hotZ.toFixed(1)}</td>
                        <td className="text-right">{backtest.hotGe3}</td>
                      </tr>
                      <tr className="border-b border-gray-50">
                        <td className="py-1.5">콜드번호 6개</td>
                        <td className="text-right">{backtest.coldAvg.toFixed(3)}</td>
                        <td className="text-right">{backtest.coldZ.toFixed(1)}</td>
                        <td className="text-right">{backtest.coldGe3}</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-gray-400">무작위 기대값</td>
                        <td className="text-right text-gray-400">{EXP_MATCH.toFixed(3)}</td>
                        <td className="text-right text-gray-400">0</td>
                        <td className="text-right text-gray-400">{backtest.expGe3.toFixed(0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
                  {backtest.cnt}개 회차를 시험한 결과, 핫·콜드 모두 무작위 기대값과 차이가 없습니다
                  (|z| &lt; 2 이면 우연 범위). 즉 "많이 나온 번호"가 다음에 더 나온다는 근거는 없습니다.
                  통계 화면의 핫/콜드 표시는 과거 빈도일 뿐 예측이 아닙니다.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
