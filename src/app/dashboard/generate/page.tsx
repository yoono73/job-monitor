"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/* ─── Types ─── */
interface DrawRow {
  draw_no: number;
  n1: number; n2: number; n3: number;
  n4: number; n5: number; n6: number;
}
type Six = [number, number, number, number, number, number];
interface LottoSet {
  idx: number; icon: string; method: string;
  category: string; desc: string; numbers: Six;
}
type MethodKey =
  | "hot" | "cold" | "pairs" | "carryover"
  | "pattern" | "hot_pattern" | "cold_pattern" | "ac"
  | "random" | "balance" | "section" | "ending"
  | "bayes" | "fav" | "prime" | "norepeat"
  | "overdue" | "recent20" | "bayes_overdue"
  | "spread";

interface BayesStat {
  number: number;
  posterior_mean: number;
  bayesian_rank: number;
}

/* ─── Algorithm Helpers ─── */
const getNums = (d: DrawRow) => [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6];

function weightedPick(pool: number[], wt: (n: number) => number): number {
  let r = Math.random() * pool.reduce((s, n) => s + wt(n), 0);
  for (const n of pool) { r -= wt(n); if (r <= 0) return n; }
  return pool[pool.length - 1];
}

function isBalanced(nums: number[]): boolean {
  const sum = nums.reduce((a, b) => a + b, 0);
  const odd = nums.filter(n => n % 2 === 1).length;
  return sum >= 90 && sum <= 185 && odd >= 2 && odd <= 4;
}

/* ── 통계기반 ── */
function genHot(draws: DrawRow[]): Six {
  const freq = new Array(46).fill(1);
  draws.slice(0, 100).forEach(d => getNums(d).forEach(n => freq[n]++));
  const top15 = Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => freq[b] - freq[a]).slice(0, 15);
  const sel: number[] = [];
  let pool = [...top15];
  while (sel.length < 6 && pool.length > 0) {
    const p = weightedPick(pool, n => freq[n]);
    sel.push(p); pool = pool.filter(n => n !== p);
  }
  return sel.sort((a, b) => a - b) as Six;
}

/* ── 오버듀 전략 (draws[0] = 최신, 내림차순) ── */
function genOverdue(draws: DrawRow[]): Six {
  if (draws.length === 0) return genRandom();
  const total = draws.length;
  const freq = new Array(46).fill(0);
  // draws[0]이 최신이므로 첫 등장 인덱스가 곧 가장 최근 출현 위치
  const lastIdx = new Array(46).fill(total); // total = 한 번도 안 나옴 (sentinel)

  draws.forEach((d, i) => {
    [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(n => {
      freq[n]++;
      if (lastIdx[n] === total) lastIdx[n] = i; // 첫 등장 = 가장 최근 출현
    });
  });

  // 오버듀 점수: 최근 미출현 기간 / 평균 출현 주기
  const scores = Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
    const count = freq[n] || 1;
    const avgPeriod = total / count;
    const gap = lastIdx[n]; // 최신 기준 경과 회차 (index = gap)
    return { n, score: gap / avgPeriod };
  }).sort((a, b) => b.score - a.score);

  // 상위 15개 중 랜덤 선택
  const top15 = scores.slice(0, 15);
  const sel: number[] = [];
  let pool = top15.map(s => s.n);
  while (sel.length < 6 && pool.length > 0) {
    const picked = pool[Math.floor(Math.random() * pool.length)];
    sel.push(picked);
    pool = pool.filter(n => n !== picked);
  }
  return sel.sort((a, b) => a - b) as Six;
}

/* ── 최근 20회 핫번호 (draws[0] = 최신, 내림차순) ── */
function genRecent20(draws: DrawRow[]): Six {
  if (draws.length === 0) return genRandom();
  const recent = draws.slice(0, 20); // 최근 20회 (draws[0]이 최신이므로 앞에서 자름)
  const freq = new Array(46).fill(1);
  recent.forEach(d => [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(n => freq[n]++));
  const top12 = Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => freq[b] - freq[a]).slice(0, 12);
  return top12.sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
}

function genCold(draws: DrawRow[]): Six {
  const lastIdx = new Array(46).fill(draws.length);
  draws.forEach((d, i) => getNums(d).forEach(n => {
    if (lastIdx[n] === draws.length) lastIdx[n] = i;
  }));
  const sorted = Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => lastIdx[b] - lastIdx[a]);
  return sorted.slice(0, 10).sort(() => Math.random() - 0.5).slice(0, 6)
    .sort((a, b) => a - b) as Six;
}

function genPairs(draws: DrawRow[]): Six {
  const pairCount: Record<string, number> = {};
  draws.slice(0, 200).forEach(d => {
    const nums = getNums(d);
    for (let i = 0; i < nums.length; i++)
      for (let j = i + 1; j < nums.length; j++) {
        const key = `${Math.min(nums[i], nums[j])}-${Math.max(nums[i], nums[j])}`;
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
  });
  const pairNums = new Set<number>();
  for (const [key] of Object.entries(pairCount).sort((a, b) => b[1] - a[1])) {
    const [a, b] = key.split("-").map(Number);
    pairNums.add(a); pairNums.add(b);
    if (pairNums.size >= 15) break;
  }
  const pool = Array.from(pairNums);
  if (pool.length < 6) return genHot(draws);
  return pool.sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
}

function genCarryover(draws: DrawRow[]): Six {
  if (draws.length === 0) return genRandom();
  const prev = getNums(draws[0]).sort(() => Math.random() - 0.5);
  const carry = prev.slice(0, 2);
  const pool = Array.from({ length: 45 }, (_, i) => i + 1)
    .filter(n => !carry.includes(n)).sort(() => Math.random() - 0.5);
  return [...carry, ...pool.slice(0, 4)].sort((a, b) => a - b) as Six;
}

/* ── 패턴기반 ── */
function passPatternFilter(nums: number[]): boolean {
  const sum = nums.reduce((a, b) => a + b, 0);
  const odd = nums.filter(n => n % 2 === 1).length;
  const sorted = [...nums].sort((a, b) => a - b);
  const secs = new Set(sorted.map(n => n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5)).size;
  let cons = 0;
  for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] - sorted[i] === 1) cons++;
  return sum >= 100 && sum <= 159 && (odd === 3 || odd === 4) && secs >= 3 && cons >= 1;
}

function genPatternFilter(): Six {
  for (let t = 0; t < 10000; t++) {
    const nums = Array.from({ length: 45 }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
    if (passPatternFilter(nums)) return nums;
  }
  return genBalance();
}

function genPatternHot(draws: DrawRow[]): Six {
  const freq = new Array(46).fill(1);
  draws.slice(0, 100).forEach(d => getNums(d).forEach(n => freq[n]++));
  for (let t = 0; t < 10000; t++) {
    const sel: number[] = [];
    let pool = Array.from({ length: 45 }, (_, i) => i + 1);
    while (sel.length < 6) { const n = weightedPick(pool, x => freq[x]); sel.push(n); pool = pool.filter(x => x !== n); }
    const sorted = sel.sort((a, b) => a - b) as Six;
    if (passPatternFilter(sorted)) return sorted;
  }
  return genPatternFilter();
}

function genPatternCold(draws: DrawRow[]): Six {
  const lastIdx = new Array(46).fill(draws.length);
  draws.slice(0, 50).forEach((d, i) => getNums(d).forEach(n => {
    if (lastIdx[n] === draws.length) lastIdx[n] = i;
  }));
  for (let t = 0; t < 10000; t++) {
    const sel: number[] = [];
    let pool = Array.from({ length: 45 }, (_, i) => i + 1);
    while (sel.length < 6) { const n = weightedPick(pool, x => lastIdx[x]); sel.push(n); pool = pool.filter(x => x !== n); }
    const sorted = sel.sort((a, b) => a - b) as Six;
    if (passPatternFilter(sorted)) return sorted;
  }
  return genPatternFilter();
}

function calcAC(nums: number[]): number {
  const diffs = new Set<number>();
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++)
      diffs.add(Math.abs(nums[i] - nums[j]));
  return diffs.size - (nums.length - 1);
}

function genACValue(): Six {
  for (let t = 0; t < 10000; t++) {
    const nums = Array.from({ length: 45 }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5).slice(0, 6);
    if (calcAC(nums) >= 7 && calcAC(nums) <= 9) return nums.sort((a, b) => a - b) as Six;
  }
  return genBalance();
}

/* ── 균형기반 ── */
function genRandom(): Six {
  return Array.from({ length: 45 }, (_, i) => i + 1)
    .sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
}

function genBalance(): Six {
  for (let t = 0; t < 5000; t++) {
    const secs: [number, number][] = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 45]];
    const nums = secs.map(([lo, hi]) => Math.floor(Math.random() * (hi - lo + 1)) + lo);
    const rem = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => !nums.includes(n));
    nums.push(rem[Math.floor(Math.random() * rem.length)]);
    const sorted = nums.sort((a, b) => a - b) as Six;
    if (new Set(sorted).size === 6 && isBalanced(sorted)) return sorted;
  }
  return Array.from({ length: 45 }, (_, i) => i + 1)
    .sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
}

function genSectionEqual(): Six {
  const sections: [number, number][] = [[1, 9], [10, 18], [19, 27], [28, 36], [37, 45]];
  const nums = sections.map(([lo, hi]) => Math.floor(Math.random() * (hi - lo + 1)) + lo);
  const pool = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => !nums.includes(n));
  nums.push(pool[Math.floor(Math.random() * pool.length)]);
  return nums.sort((a, b) => a - b) as Six;
}

function genEndingDistrib(): Six {
  for (let t = 0; t < 5000; t++) {
    const nums = Array.from({ length: 45 }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5).slice(0, 6);
    if (new Set(nums.map(n => n % 10)).size >= 5) return nums.sort((a, b) => a - b) as Six;
  }
  return genRandom();
}

/* ── 베이지안 ── */
function genBayes(bayesStats: BayesStat[]): Six {
  if (bayesStats.length < 6) {
    // fallback: random
    return Array.from({ length: 45 }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
  }
  const totalWeight = bayesStats.reduce((s, b) => s + b.posterior_mean, 0);
  const selected: number[] = [];
  const pool = [...bayesStats];
  while (selected.length < 6 && pool.length > 0) {
    const poolWeight = pool.reduce((s, b) => s + b.posterior_mean, 0);
    let r = Math.random() * poolWeight;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].posterior_mean;
      if (r <= 0) { idx = i; break; }
    }
    selected.push(pool[idx].number);
    pool.splice(idx, 1);
  }
  void totalWeight; // suppress unused warning
  return selected.sort((a, b) => a - b) as Six;
}

/* ── 베이지안 + 오버듀 복합 전략 ── */
function genBayesOverdue(draws: DrawRow[], bayesStats: BayesStat[]): Six {
  if (bayesStats.length < 6 || draws.length === 0) return genBayes(bayesStats);
  const total = draws.length;
  const freq = new Array(46).fill(0);
  const lastIdx = new Array(46).fill(total); // sentinel: 한 번도 안 나옴

  // draws[0] = 최신 기준 (내림차순)
  draws.forEach((d, i) => {
    [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6].forEach(n => {
      freq[n]++;
      if (lastIdx[n] === total) lastIdx[n] = i;
    });
  });

  // 오버듀 점수 계산
  const overdueMap: Record<number, number> = {};
  for (let n = 1; n <= 45; n++) {
    const count = freq[n] || 1;
    overdueMap[n] = lastIdx[n] / (total / count);
  }

  // 베이지안 정규화
  const bMin = Math.min(...bayesStats.map(b => b.posterior_mean));
  const bMax = Math.max(...bayesStats.map(b => b.posterior_mean));
  const bRange = bMax - bMin || 0.001;

  // 오버듀 정규화
  const odVals = Object.values(overdueMap);
  const odMin = Math.min(...odVals);
  const odMax = Math.max(...odVals);
  const odRange = odMax - odMin || 0.001;

  // 복합 점수 (0.5 : 0.5 가중치)
  const combined = bayesStats.map(b => ({
    number: b.number,
    score: ((b.posterior_mean - bMin) / bRange) * 0.5 + ((overdueMap[b.number] - odMin) / odRange) * 0.5,
  })).sort((a, b) => b.score - a.score);

  // 상위 15개 중 가중 랜덤 선택
  const top15 = combined.slice(0, 15);
  const sel: number[] = [];
  let pool = [...top15];
  while (sel.length < 6 && pool.length > 0) {
    const tw = pool.reduce((s, p) => s + p.score, 0);
    let r = Math.random() * tw;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].score; if (r <= 0) { idx = i; break; } }
    sel.push(pool[idx].number);
    pool.splice(idx, 1);
  }
  return sel.sort((a, b) => a - b) as Six;
}

/* ─── 수비학 행운번호 ─── */
function digitalRoot(n: number): number {
  let x = n;
  while (x >= 10) x = String(x).split("").reduce((s, c) => s + +c, 0);
  return x;
}
function calcLifePath(bd: string): number {
  return digitalRoot(bd.replace(/-/g, "").split("").reduce((s, c) => s + +c, 0));
}
function calcDayNum(date: Date): number {
  const str = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return digitalRoot(str.split("").reduce((s, c) => s + +c, 0));
}
function genLucky(lifePath: number, dayNum: number, today: Date): { nums: Six; passes: boolean } {
  const base = ((lifePath + dayNum - 1) % 45) + 1;
  // 결정론적 시드: 같은 생명수 + 날짜 = 항상 같은 번호
  let s = (lifePath * 97 + dayNum * 31 + today.getFullYear() + (today.getMonth() + 1) * 13 + today.getDate() * 7) | 0;
  if (s === 0) s = 1;
  const rand = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
  const all = Array.from({ length: 45 }, (_, i) => i + 1);
  // 기준번호 근처에 가중치 부여하면서 패턴 필터 통과 조합 탐색
  for (let t = 0; t < 3000; t++) {
    const scored = all
      .map(n => ({ n, w: rand() * 0.5 + (1 - Math.abs(n - base) / 45) * 0.5 }))
      .sort((a, b) => b.w - a.w)
      .map(x => x.n);
    const pick = scored.slice(0, 6).sort((a, b) => a - b) as Six;
    if (passPatternFilter(pick)) return { nums: pick, passes: true };
  }
  const fallback = [...all].sort(() => rand() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
  return { nums: fallback, passes: passPatternFilter(fallback) };
}

/* ── 선호번호 전략 ── */
function genFavorites(favorites: number[]): Six {
  if (favorites.length === 0) return genPatternFilter();
  const all = Array.from({ length: 45 }, (_, i) => i + 1);
  for (let t = 0; t < 8000; t++) {
    // 선호번호 중 2~4개 랜덤 포함 (6개 이상이면 6개 전부 시도)
    const shuffled = [...favorites].sort(() => Math.random() - 0.5);
    const favCount = Math.min(shuffled.length, favorites.length >= 6 ? 6 : Math.floor(Math.random() * 3) + 2);
    const picked = shuffled.slice(0, favCount);
    const rest = all.filter(n => !picked.includes(n)).sort(() => Math.random() - 0.5);
    const candidate = [...picked, ...rest.slice(0, 6 - picked.length)].sort((a, b) => a - b) as Six;
    if (passPatternFilter(candidate)) return candidate;
  }
  return genPatternFilter();
}

/* ── 소수 전략 ── */
const PRIMES_1_45 = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43];
function genPrime(): Six {
  for (let t = 0; t < 5000; t++) {
    const cnt = Math.floor(Math.random() * 3) + 2; // 소수 2~4개
    const shuffled = [...PRIMES_1_45].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, cnt);
    const rest = Array.from({ length: 45 }, (_, i) => i + 1)
      .filter(n => !picked.includes(n)).sort(() => Math.random() - 0.5);
    const candidate = [...picked, ...rest.slice(0, 6 - picked.length)].sort((a, b) => a - b) as Six;
    if (isBalanced(candidate)) return candidate;
  }
  return genBalance();
}

/* ── 전회 비출현 ── */
function genNoRepeat(draws: DrawRow[]): Six {
  if (draws.length === 0) return genRandom();
  const prev = new Set(getNums(draws[0]));
  const pool = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => !prev.has(n));
  for (let t = 0; t < 5000; t++) {
    const nums = [...pool].sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
    if (isBalanced(nums)) return nums;
  }
  return pool.sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
}

/* ── 어머니 전용 ── */
function genConsecutive(): Six {
  for (let t = 0; t < 3000; t++) {
    const s = Math.floor(Math.random() * 44) + 1;
    const pair = [s, s + 1];
    const rest = Array.from({ length: 45 }, (_, i) => i + 1)
      .filter(n => !pair.includes(n)).sort(() => Math.random() - 0.5).slice(0, 4);
    const nums = [...pair, ...rest].sort((a, b) => a - b);
    if (isBalanced(nums)) return nums as Six;
  }
  return genBalance();
}
function genTopFreq(draws: DrawRow[]): Six {
  const freq = new Array(46).fill(0);
  draws.forEach(d => getNums(d).forEach(n => freq[n]++));
  const top20 = Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => freq[b] - freq[a]).slice(0, 20);
  const sel: number[] = [];
  let pool = [...top20];
  while (sel.length < 6 && pool.length > 0) {
    const p = weightedPick(pool, n => freq[n]);
    sel.push(p); pool = pool.filter(n => n !== p);
  }
  return sel.sort((a, b) => a - b) as Six;
}

/* ── 번호 분산 전략 — 세트 간 번호 중복 최소화 ── */
function genSpread(usedNumbers: Set<number>): Six {
  const all = Array.from({ length: 45 }, (_, i) => i + 1);
  // 아직 한 번도 사용되지 않은 번호 우선 사용
  const unused = all.filter(n => !usedNumbers.has(n));
  const pool = unused.length >= 6 ? unused : all; // 번호가 부족하면 전체 pool 사용
  for (let t = 0; t < 5000; t++) {
    const nums = [...pool].sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
    if (isBalanced(nums)) return nums;
  }
  return pool.sort(() => Math.random() - 0.5).slice(0, 6).sort((a, b) => a - b) as Six;
}

/* ─── Method Registry ─── */
const METHODS: Record<MethodKey, { category: string; icon: string; label: string; desc: string }> = {
  fav:          { category: "개인화",  icon: "⭐", label: "선호번호",  desc: "내 번호 2~4개 우선 포함" },
  hot:          { category: "통계기반", icon: "🔥", label: "핫 번호",   desc: "최근 100회 고빈도" },
  cold:         { category: "통계기반", icon: "❄️", label: "콜드 번호", desc: "장기 미출현 번호" },
  pairs:        { category: "통계기반", icon: "🔗", label: "번호쌍",    desc: "자주 동반 출현" },
  carryover:    { category: "통계기반", icon: "🔄", label: "이월 번호", desc: "전회 번호 2개 포함" },
  norepeat:     { category: "통계기반", icon: "🚫", label: "전회제외",  desc: "직전 당첨번호 완전 제외" },
  pattern:      { category: "패턴기반", icon: "🎯", label: "패턴필터",  desc: "합계·홀짝·구간·연속" },
  hot_pattern:  { category: "패턴기반", icon: "🔥", label: "핫+필터",   desc: "고빈도 중 조건 충족" },
  cold_pattern: { category: "패턴기반", icon: "❄️", label: "콜드+필터", desc: "미출현 중 조건 충족" },
  ac:           { category: "패턴기반", icon: "📐", label: "AC값",      desc: "산술복잡도 7~9" },
  prime:        { category: "패턴기반", icon: "🔢", label: "소수전략",  desc: "소수 2~4개 우선 포함" },
  random:       { category: "균형기반", icon: "🎲", label: "랜덤",      desc: "순수 무작위" },
  balance:      { category: "균형기반", icon: "⚖️", label: "밸런스",    desc: "구간·홀짝·합계 균형" },
  section:      { category: "균형기반", icon: "📊", label: "구간균등",  desc: "5구간 각 1개씩" },
  ending:       { category: "균형기반", icon: "🔢", label: "끝수균등",  desc: "끝자리 0~9 분산" },
  bayes:        { category: "베이지안", icon: "🧮", label: "베이지안",    desc: "1,227회 사후확률 가중 추출" },
  bayes_overdue:{ category: "베이지안", icon: "🔮", label: "복합전략",    desc: "베이지안 확률 × 오버듀 지수 복합 점수" },
  overdue:      { category: "통계기반", icon: "⏰", label: "오버듀",     desc: "오래 안 나온 번호 위주 (미출현 주기 기반)" },
  recent20:     { category: "통계기반", icon: "📅", label: "최근20회",   desc: "최근 20회 고빈도 번호 집중" },
  spread:       { category: "균형기반", icon: "🌐", label: "분산커버",   desc: "세트 간 번호 중복 최소화 · 더 많은 번호 커버" },
};

const CATEGORY_GROUPS = [
  { cat: "개인화",  keys: ["fav"] as MethodKey[] },
  { cat: "베이지안", keys: ["bayes", "bayes_overdue"] as MethodKey[] },
  { cat: "통계기반", keys: ["hot", "cold", "pairs", "carryover", "norepeat", "overdue", "recent20"] as MethodKey[] },
  { cat: "패턴기반", keys: ["pattern", "hot_pattern", "cold_pattern", "ac", "prime"] as MethodKey[] },
  { cat: "균형기반", keys: ["random", "balance", "section", "ending", "spread"] as MethodKey[] },
];

const DEFAULT_KEYS: MethodKey[] = [
  "fav", "bayes", "bayes_overdue", "hot", "pattern", "balance", "cold",
  "pairs", "norepeat", "prime", "section",
];

function runGenerator(key: MethodKey, draws: DrawRow[], bayesStats?: BayesStat[], favorites?: number[], usedNumbers?: Set<number>): Six {
  switch (key) {
    case "fav":          return genFavorites(favorites ?? []);
    case "hot":          return genHot(draws);
    case "cold":         return genCold(draws);
    case "pairs":        return genPairs(draws);
    case "carryover":    return genCarryover(draws);
    case "norepeat":     return genNoRepeat(draws);
    case "pattern":      return genPatternFilter();
    case "hot_pattern":  return genPatternHot(draws);
    case "cold_pattern": return genPatternCold(draws);
    case "ac":           return genACValue();
    case "prime":        return genPrime();
    case "random":       return genRandom();
    case "balance":      return genBalance();
    case "section":      return genSectionEqual();
    case "ending":       return genEndingDistrib();
    case "bayes":        return genBayes(bayesStats ?? []);
    case "bayes_overdue": return genBayesOverdue(draws, bayesStats ?? []);
    case "overdue":      return genOverdue(draws);
    case "recent20":     return genRecent20(draws);
    case "spread":       return genSpread(usedNumbers ?? new Set());
  }
}

/* ─── Category color map ─── */
const CAT_COLOR: Record<string, { badge: string; border: string; selBg: string; text: string }> = {
  "개인화":   { badge: "bg-yellow-100 text-yellow-700", border: "border-yellow-300", selBg: "bg-yellow-50", text: "text-yellow-700" },
  "베이지안": { badge: "bg-violet-100 text-violet-700", border: "border-violet-300", selBg: "bg-violet-50", text: "text-violet-700" },
  "통계기반": { badge: "bg-emerald-100 text-emerald-700", border: "border-emerald-300", selBg: "bg-emerald-50", text: "text-emerald-700" },
  "패턴기반": { badge: "bg-amber-100 text-amber-700",    border: "border-amber-300",   selBg: "bg-amber-50",   text: "text-amber-700" },
  "균형기반": { badge: "bg-gray-100 text-gray-600",      border: "border-gray-300",    selBg: "bg-gray-50",    text: "text-gray-600" },
};

/* ─── Ball ─── */
function ballColor(n: number) {
  if (n <= 10) return "bg-[#FBC400] text-black";
  if (n <= 20) return "bg-[#069FDD] text-white";
  if (n <= 30) return "bg-[#FF5757] text-white";
  if (n <= 40) return "bg-[#AAAAAA] text-white";
  return "bg-[#B0D840] text-black";
}
function Ball({ n }: { n: number }) {
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-bold text-sm shrink-0 shadow-sm ${ballColor(n)}`}>
      {n}
    </span>
  );
}

/* ─── Result Card ─── */
function ResultCard({ s, copied, saved, onCopy, onSave }: {
  s: LottoSet;
  copied: number | null;
  saved: Set<number>;
  onCopy: (nums: Six, idx: number) => void;
  onSave: (s: LottoSet) => void;
}) {
  const cc = CAT_COLOR[s.category] ?? CAT_COLOR["균형기반"];
  const isSaved = saved.has(s.idx);
  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow
      ${isSaved ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cc.badge}`}>
            {s.category}
          </span>
          <span className="text-base shrink-0">{s.icon}</span>
          <span className="font-bold text-gray-800 text-sm shrink-0">{s.method}</span>
          <span className="text-gray-400 text-xs truncate hidden sm:block">{s.desc}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={() => onCopy(s.numbers, s.idx)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition
              ${copied === s.idx
                ? `${cc.text} ${cc.border} ${cc.selBg}`
                : "text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-400"}`}
          >
            {copied === s.idx ? "✓ 복사" : "복사"}
          </button>
          <button
            onClick={() => !isSaved && onSave(s)}
            disabled={isSaved}
            className={`text-xs px-2.5 py-1 rounded-lg border transition
              ${isSaved
                ? "text-emerald-600 border-emerald-300 bg-emerald-50 cursor-default"
                : "text-gray-400 border-gray-200 hover:text-emerald-600 hover:border-emerald-400"}`}
          >
            {isSaved ? "✓ 저장됨" : "저장"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {s.numbers.map((n, i) => <Ball key={i} n={n} />)}
      </div>
      <p className="text-xs text-gray-400 mt-2 sm:hidden">{s.desc}</p>
    </div>
  );
}

/* ─── Constants ─── */
const MOM_EMAIL = "yoono73@gmail.com";
const MOM_CONFIGS = [
  { icon: "🔥", method: "핫",       category: "통계기반", desc: "최근 100회 고빈도" },
  { icon: "❄️", method: "콜드",     category: "통계기반", desc: "오랫동안 안 나온 번호" },
  { icon: "🔗", method: "연속",     category: "균형기반", desc: "연속번호 포함 균형 조합" },
  { icon: "⚖️", method: "밸런스",   category: "균형기반", desc: "5구간·홀짝·합계 균형" },
  { icon: "📊", method: "역대최다",  category: "통계기반", desc: "전체 누적 최다 출현" },
];

/* ─── Page ─── */
export default function GeneratePage() {
  const supabase = useMemo(() => createClient(), []);
  const [draws,     setDraws]   = useState<DrawRow[]>([]);
  const [ready,     setReady]   = useState(false);
  const [busy,      setBusy]    = useState(false);
  const [sets,      setSets]    = useState<LottoSet[] | null>(null);
  const [copied,    setCopied]  = useState<number | null>(null);
  const [isMom,     setIsMom]   = useState(false);
  const [showMom,   setShowMom] = useState(false);
  const [userId,    setUserId]  = useState<string | null>(null);
  const [savedSets, setSavedSets] = useState<Set<number>>(new Set());
  const [saveMsg,   setSaveMsg] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [myIdxs,    setMyIdxs]   = useState<Set<number>>(new Set());
  const [shareCopied, setShareCopied] = useState(false);

  const [setCount,    setSetCount]   = useState(5);
  const [methodKeys,  setMethodKeys] = useState<MethodKey[]>(DEFAULT_KEYS.slice(0, 5));
  const [bayesStats,  setBayesStats] = useState<BayesStat[]>([]);

  // 수비학 행운번호
  const [birthdate,   setBirthdate]  = useState<string | null>(null);
  const [bdInput,     setBdInput]    = useState("");
  const [showBdForm,  setShowBdForm] = useState(false);
  const [luckyCopied, setLuckyCopied] = useState(false);

  // 선호번호
  const [favorites,   setFavorites]  = useState<number[]>([]);
  const [favInput,    setFavInput]   = useState("");

  const nextDrawNo = draws.length > 0 ? draws[0].draw_no + 1 : null;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsMom(user?.email === MOM_EMAIL);
      setUserId(user?.id ?? null);
    });
    supabase.from("lotto_draws")
      .select("draw_no,n1,n2,n3,n4,n5,n6")
      .order("draw_no", { ascending: false })
      .then(({ data }) => { setDraws((data as DrawRow[]) ?? []); setReady(true); });

    supabase.from("lotto_number_stats")
      .select("number,posterior_mean,bayesian_rank")
      .order("bayesian_rank")
      .then(({ data }) => { if (data) setBayesStats(data as BayesStat[]); });

    // 생년월일 로컬 스토리지 로드
    try {
      const stored = localStorage.getItem("lotto_birthdate");
      if (stored) setBirthdate(stored);
    } catch {}
    // 선호번호 로컬 스토리지 로드
    try {
      const stored = localStorage.getItem("lotto_favorites");
      if (stored) setFavorites(JSON.parse(stored));
    } catch {}
  }, [supabase]);

  // 행운 번호 계산 (생년월일 있을 때)
  const today = useMemo(() => new Date(), []);
  const luckyCalc = useMemo(() => {
    if (!birthdate) return null;
    const lifePath = calcLifePath(birthdate);
    const dayNum   = calcDayNum(today);
    const { nums, passes } = genLucky(lifePath, dayNum, today);
    return { lifePath, dayNum, nums, passes };
  }, [birthdate, today]);

  const saveBirthdate = (bd: string) => {
    try { localStorage.setItem("lotto_birthdate", bd); } catch {}
    setBirthdate(bd);
    setShowBdForm(false);
  };

  const addFav = (val: string) => {
    const n = parseInt(val);
    if (!n || n < 1 || n > 45 || favorites.includes(n) || favorites.length >= 10) return;
    const updated = [...favorites, n].sort((a, b) => a - b);
    setFavorites(updated);
    try { localStorage.setItem("lotto_favorites", JSON.stringify(updated)); } catch {}
    setFavInput("");
  };

  const removeFav = (n: number) => {
    const updated = favorites.filter(x => x !== n);
    setFavorites(updated);
    try { localStorage.setItem("lotto_favorites", JSON.stringify(updated)); } catch {}
  };

  const switchTab = (mom: boolean) => { setShowMom(mom); setSets(null); setSavedSets(new Set()); };

  const saveSet = useCallback(async (s: LottoSet) => {
    if (!userId || !nextDrawNo) return;
    const { error } = await supabase.from("saved_numbers").insert({
      user_id:  userId,
      draw_no:  nextDrawNo,
      numbers:  s.numbers,
      method:   s.method,
      category: s.category,
      set_idx:  s.idx,
    });
    if (!error) {
      setSavedSets(prev => new Set([...prev, s.idx]));
      setSaveMsg(`${nextDrawNo}회차에 저장됐어요 ✓`);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }, [userId, nextDrawNo, supabase]);

  const updateSetCount = (n: number) => {
    setSetCount(n);
    setMethodKeys(prev =>
      n > prev.length
        ? [...prev, ...DEFAULT_KEYS.slice(prev.length, n)]
        : prev.slice(0, n)
    );
    setSets(null);
  };

  const updateMethodKey = (idx: number, key: MethodKey) => {
    setMethodKeys(prev => { const next = [...prev]; next[idx] = key; return next; });
    setSets(null);
  };

  /* 어머니 생성 */
  const generateMom = useCallback(() => {
    if (!ready || busy) return;
    setBusy(true); setSets(null); setSavedSets(new Set());
    setTimeout(() => {
      setSets([
        { idx: 1, ...MOM_CONFIGS[0], numbers: genHot(draws)     },
        { idx: 2, ...MOM_CONFIGS[1], numbers: genCold(draws)    },
        { idx: 3, ...MOM_CONFIGS[2], numbers: genConsecutive()  },
        { idx: 4, ...MOM_CONFIGS[3], numbers: genBalance()      },
        { idx: 5, ...MOM_CONFIGS[4], numbers: genTopFreq(draws) },
      ]);
      setBusy(false);
    }, 700);
  }, [draws, ready, busy]);

  /* 커스텀 생성 */
  const generateCustom = useCallback(() => {
    if (!ready || busy) return;
    setBusy(true); setSets(null); setSavedSets(new Set());
    setTimeout(() => {
      const usedNums = new Set<number>();
      setSets(
        methodKeys.map((key, i) => {
          const numbers = runGenerator(key, draws, bayesStats, favorites, usedNums);
          numbers.forEach(n => usedNums.add(n));
          return { idx: i + 1, ...METHODS[key], method: METHODS[key].label, numbers };
        })
      );
      setBusy(false);
    }, 700);
  }, [draws, ready, busy, methodKeys, bayesStats]);

  const copy = (nums: Six, idx: number) => {
    navigator.clipboard.writeText(nums.join("  "));
    setCopied(idx); setTimeout(() => setCopied(null), 1500);
  };

  /* ── 공유 링크 생성 ── */
  const buildShareUrl = (targetSets: LottoSet[]) => {
    const encoded = targetSets.map(s => s.numbers.join("-")).join("_");
    const drawPart = nextDrawNo ? `&t=${nextDrawNo}` : "";
    return `${window.location.origin}/share?s=${encoded}${drawPart}`;
  };

  const shareAll = () => {
    if (!sets) return;
    const url = buildShareUrl(sets);
    navigator.clipboard.writeText(url);
    setShareCopied(true); setTimeout(() => setShareCopied(false), 2000);
  };

  /* ── 2인 분산 ── */
  const toggleSplitMode = () => {
    if (!splitMode && sets) {
      const half = Math.ceil(sets.length / 2);
      setMyIdxs(new Set(sets.slice(0, half).map(s => s.idx)));
    }
    setSplitMode(v => !v);
  };

  const toggleIdx = (idx: number) => {
    setMyIdxs(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const copyGroup = (mine: boolean) => {
    if (!sets) return;
    const group = sets.filter(s => mine ? myIdxs.has(s.idx) : !myIdxs.has(s.idx));
    const text = group.map((s, i) => `${i + 1}. ${s.numbers.join("  ")}`).join("\n");
    navigator.clipboard.writeText(text);
  };

  const shareGroup = (mine: boolean) => {
    if (!sets) return;
    const group = sets.filter(s => mine ? myIdxs.has(s.idx) : !myIdxs.has(s.idx));
    const url = buildShareUrl(group);
    navigator.clipboard.writeText(url);
  };

  /* ─── Render ─── */
  return (
    <div className="px-4 py-5 md:px-6 lg:px-8 max-w-2xl mx-auto">

      {/* 어머니 탭 버튼 (yoono73만) */}
      {isMom && (
        <div className="flex gap-2 mb-5">
          <button onClick={() => switchTab(false)}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all
              ${!showMom
                ? "bg-emerald-500 text-white shadow-md shadow-emerald-200"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
            🎲 번호 생성
          </button>
          <button onClick={() => switchTab(true)}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all
              ${showMom
                ? "bg-rose-500 text-white shadow-md shadow-rose-200"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
            🧧 어머니
          </button>
        </div>
      )}

      {/* ━━━ 🔮 오늘의 행운 번호 ━━━ */}
      <div className="mb-5">
        {(!birthdate || showBdForm) ? (
          /* ── 생년월일 입력 폼 ── */
          <div className="bg-gradient-to-br from-fuchsia-50 to-purple-50 border border-fuchsia-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔮</span>
              <h3 className="text-sm font-bold text-fuchsia-800">오늘의 행운 번호</h3>
              {birthdate && (
                <button onClick={() => setShowBdForm(false)} className="ml-auto text-[11px] text-gray-400 hover:text-gray-600">
                  취소
                </button>
              )}
            </div>
            <p className="text-xs text-fuchsia-600 mb-3">
              생년월일을 입력하면 <span className="font-bold">수비학(생명수·일진수)</span> 기반으로
              오늘의 행운 번호를 계산해드려요. 매일 바뀌며 저장되지 않고 기기에만 보관됩니다.
            </p>
            <div className="flex gap-2">
              <input
                type="date"
                value={bdInput}
                onChange={e => setBdInput(e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                className="flex-1 text-sm border border-fuchsia-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-fuchsia-300 bg-white"
                placeholder="생년월일"
              />
              <button
                onClick={() => bdInput && saveBirthdate(bdInput)}
                disabled={!bdInput}
                className="px-4 py-2 bg-fuchsia-500 hover:bg-fuchsia-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
              >
                계산하기
              </button>
            </div>
          </div>
        ) : luckyCalc ? (
          /* ── 행운 번호 결과 ── */
          <div className="bg-gradient-to-br from-fuchsia-50 via-purple-50 to-violet-50 border border-fuchsia-200 rounded-2xl p-4 relative overflow-hidden">
            <div className="absolute top-2 right-3 text-fuchsia-100 text-5xl select-none">🔮</div>
            {/* 헤더 */}
            <div className="flex items-center gap-2 mb-1 relative">
              <span className="text-lg">🔮</span>
              <h3 className="text-sm font-bold text-fuchsia-800">오늘의 행운 번호</h3>
              <div className="ml-auto flex items-center gap-1.5">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  luckyCalc.passes ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {luckyCalc.passes ? "✓ 패턴 통과" : "△ 참고용"}
                </span>
                <button
                  onClick={() => setShowBdForm(true)}
                  className="text-[10px] text-fuchsia-400 hover:text-fuchsia-600 underline"
                >
                  변경
                </button>
              </div>
            </div>
            {/* 생명수 / 일진수 */}
            <div className="flex items-center gap-3 mb-3 text-[11px] text-fuchsia-500 relative">
              <span className="bg-fuchsia-100 rounded-lg px-2 py-0.5">
                생명수 <strong className="text-fuchsia-700">{luckyCalc.lifePath}</strong>
              </span>
              <span className="text-fuchsia-200">+</span>
              <span className="bg-violet-100 rounded-lg px-2 py-0.5">
                일진수 <strong className="text-violet-700">{luckyCalc.dayNum}</strong>
              </span>
              <span className="text-fuchsia-200">→</span>
              <span className="bg-purple-100 rounded-lg px-2 py-0.5">
                기준 <strong className="text-purple-700">{((luckyCalc.lifePath + luckyCalc.dayNum - 1) % 45) + 1}번</strong>
              </span>
            </div>
            {/* 번호 볼 */}
            <div className="flex items-center gap-2 mb-3 relative">
              {luckyCalc.nums.map((n, i) => <Ball key={i} n={n} />)}
            </div>
            {/* 복사 버튼 */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(luckyCalc.nums.join("  "));
                setLuckyCopied(true); setTimeout(() => setLuckyCopied(false), 1500);
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition relative
                ${luckyCopied
                  ? "text-fuchsia-600 border-fuchsia-300 bg-fuchsia-50"
                  : "text-gray-400 border-gray-200 hover:text-fuchsia-600 hover:border-fuchsia-300"}`}
            >
              {luckyCopied ? "✓ 복사됨" : "복사"}
            </button>
            <p className="text-[10px] text-fuchsia-300 mt-2 relative">
              오늘({today.getMonth()+1}/{today.getDate()}) 기준 · 매일 갱신 · 생년월일 기기 저장만
            </p>
          </div>
        ) : null}
      </div>

      {/* ━━━ ⭐ 내 선호 번호 ━━━ */}
      <div className="mb-5">
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⭐</span>
            <h3 className="text-sm font-bold text-yellow-800">내 선호 번호</h3>
            <span className="text-[10px] text-yellow-500 ml-auto">
              {favorites.length}/10개 · 생성 시 2~4개 우선 포함
            </span>
          </div>

          {/* 저장된 번호 목록 */}
          {favorites.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-3">
              {favorites.map(n => (
                <div key={n} className="relative inline-block">
                  <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-bold text-sm shadow-sm ${
                    n <= 10 ? "bg-[#FBC400] text-black" : n <= 20 ? "bg-[#069FDD] text-white" :
                    n <= 30 ? "bg-[#FF5757] text-white" : n <= 40 ? "bg-[#AAAAAA] text-white" : "bg-[#B0D840] text-black"
                  }`}>{n}</span>
                  <button
                    onClick={() => removeFav(n)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-gray-400 hover:bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold transition leading-none"
                  >×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-yellow-600 mb-3">
              번호를 추가하면 <span className="font-bold">⭐ 선호번호</span> 전략에서 우선 포함됩니다.
            </p>
          )}

          {/* 번호 추가 입력 */}
          {favorites.length < 10 && (
            <div className="flex gap-2">
              <input
                type="number"
                min={1} max={45}
                value={favInput}
                onChange={e => setFavInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addFav(favInput)}
                placeholder="1~45"
                className="w-24 text-sm border border-yellow-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-yellow-300 bg-white text-center font-bold"
              />
              <button
                onClick={() => addFav(favInput)}
                disabled={!favInput}
                className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 text-sm font-bold rounded-xl disabled:opacity-40 transition"
              >
                추가
              </button>
              {favorites.length > 0 && (
                <button
                  onClick={() => { setFavorites([]); try { localStorage.removeItem("lotto_favorites"); } catch {} }}
                  className="px-3 py-2 text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-300 rounded-xl transition"
                >
                  전체 삭제
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ━━━ 어머니 탭 ━━━ */}
      {isMom && showMom && (
        <>
          <div className="bg-gradient-to-br from-rose-400 via-pink-400 to-red-300 rounded-2xl p-6 mb-6 shadow-lg text-center relative overflow-hidden">
            <div className="absolute top-2 left-3 text-white/20 text-5xl select-none">🍀</div>
            <div className="absolute bottom-2 right-3 text-white/20 text-5xl select-none">🍀</div>
            <div className="relative">
              <div className="text-5xl mb-2">🧧</div>
              <h2 className="text-white font-extrabold text-xl tracking-tight">어머니 버전</h2>
              <p className="text-white/80 text-sm mt-1 font-medium">매주 5장 정성 생성 · 5,000원</p>
              <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                {["🔥 핫", "❄️ 콜드", "🔗 연속", "⚖️ 밸런스", "📊 역대최다"].map(tag => (
                  <span key={tag} className="text-[11px] bg-white/20 text-white px-2 py-0.5 rounded-full font-semibold">{tag}</span>
                ))}
              </div>
            </div>
          </div>
          <button onClick={generateMom} disabled={!ready || busy}
            className="w-full py-4 rounded-2xl font-bold text-base mb-6
              bg-rose-500 hover:bg-rose-600 active:scale-[.98]
              text-white shadow-lg shadow-rose-200/60
              disabled:opacity-50 transition-all duration-150">
            {!ready ? "⏳ 데이터 준비 중..." : busy ? "🎲 정성 담는 중..." : sets ? "🔄 다시 생성하기" : "이번 주 5장 생성하기 🍀"}
          </button>
          {sets && (
            <>
              {nextDrawNo && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className="text-xs text-gray-400">다음 회차</span>
                  <span className="text-xs font-bold text-rose-500">{nextDrawNo}회</span>
                  <span className="text-xs text-gray-300">· 저장 버튼으로 기록해두세요</span>
                </div>
              )}
              {saveMsg && (
                <div className="mb-3 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold text-center">
                  {saveMsg}
                </div>
              )}
              <div className="space-y-3">
                {sets.map(s => <ResultCard key={s.idx} s={s} copied={copied} saved={savedSets} onCopy={copy} onSave={saveSet} />)}
              </div>
              <div className="flex items-center justify-between px-1 py-2 mt-3 text-sm text-gray-500">
                <span>총 <strong className="text-gray-800">5장</strong></span>
                <span className="font-bold text-rose-500">= 5,000원</span>
              </div>
              <p className="text-center text-xs text-gray-300 pb-2">통계 기반 생성 · 당첨 보장 아님 · 효심으로 즐겨주세요 🧡</p>
            </>
          )}
        </>
      )}

      {/* ━━━ 번호 생성 (공통) ━━━ */}
      {(!isMom || !showMom) && (
        <>
          {/* 헤더 */}
          <div className="bg-gradient-to-br from-slate-700 via-slate-600 to-slate-500 rounded-2xl p-5 mb-5 shadow-lg text-center relative overflow-hidden">
            <div className="absolute top-2 left-3 text-white/10 text-5xl select-none">🎰</div>
            <div className="absolute bottom-2 right-3 text-white/10 text-5xl select-none">🎰</div>
            <div className="relative">
              <div className="text-4xl mb-1.5">🎲</div>
              <h2 className="text-white font-extrabold text-lg tracking-tight">로또 번호 생성</h2>
              <p className="text-white/70 text-xs mt-1">
                <span className="text-emerald-300 font-semibold">통계기반</span>
                <span className="text-white/40 mx-1.5">·</span>
                <span className="text-amber-300 font-semibold">패턴기반</span>
                <span className="text-white/40 mx-1.5">·</span>
                <span className="text-gray-300 font-semibold">균형기반</span>
              </p>
            </div>
          </div>

          {/* 세트 수 선택 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
            <p className="text-xs font-bold text-gray-500 mb-3">세트 수 선택</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button key={n} onClick={() => updateSetCount(n)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all
                    ${setCount === n
                      ? "bg-slate-700 text-white shadow-sm"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* 세트별 방식 선택 */}
          <div className="space-y-2 mb-4">
            {Array.from({ length: setCount }).map((_, i) => {
              const key = methodKeys[i] ?? "random";
              const m = METHODS[key];
              const cc = CAT_COLOR[m.category];
              return (
                <div key={i} className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 ${cc.border}`}>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cc.badge}`}>
                    {i + 1}세트
                  </span>
                  <span className="text-base shrink-0">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <select
                      value={key}
                      onChange={e => updateMethodKey(i, e.target.value as MethodKey)}
                      className={`w-full text-sm font-semibold border-0 bg-transparent outline-none cursor-pointer ${cc.text}`}
                    >
                      {CATEGORY_GROUPS.map(({ cat, keys }) => (
                        <optgroup key={cat} label={`── ${cat} ──`}>
                          {keys.map(k => (
                            <option key={k} value={k}>
                              {METHODS[k].icon} {METHODS[k].label} — {METHODS[k].desc}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 생성 버튼 */}
          <button onClick={generateCustom} disabled={!ready || busy}
            className="w-full py-4 rounded-2xl font-bold text-base mb-5
              bg-slate-700 hover:bg-slate-800 active:scale-[.98]
              text-white shadow-lg
              disabled:opacity-50 transition-all duration-150">
            {!ready ? "⏳ 데이터 준비 중..." : busy ? "🎲 생성 중..." : sets ? "🔄 다시 생성하기" : `${setCount}세트 생성하기`}
          </button>

          {/* 결과 */}
          {sets && (
            <>
              {nextDrawNo && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className="text-xs text-gray-400">다음 회차</span>
                  <span className="text-xs font-bold text-slate-600">{nextDrawNo}회</span>
                  <span className="text-xs text-gray-300">· 저장하면 추첨 후 결과 비교 가능</span>
                </div>
              )}
              {saveMsg && (
                <div className="mb-3 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold text-center">
                  {saveMsg}
                </div>
              )}
              <div className="space-y-3">
                {sets.map(s => (
                  <div key={s.idx} className="relative">
                    {/* 분산 모드 배지 */}
                    {splitMode && (
                      <button
                        onClick={() => toggleIdx(s.idx)}
                        className={`absolute -top-1.5 -left-1.5 z-10 text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-sm transition
                          ${myIdxs.has(s.idx)
                            ? "bg-blue-500 text-white border-blue-600"
                            : "bg-rose-400 text-white border-rose-500"}`}
                      >
                        {myIdxs.has(s.idx) ? "👤 나" : "👥 상대"}
                      </button>
                    )}
                    <ResultCard s={s} copied={copied} saved={savedSets} onCopy={copy} onSave={saveSet} />
                  </div>
                ))}
              </div>

              {/* ── 액션 버튼 ── */}
              <div className="flex gap-2 mt-4">
                <button onClick={shareAll}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition
                    ${shareCopied
                      ? "bg-emerald-50 border-emerald-300 text-emerald-600"
                      : "bg-white border-gray-200 text-gray-600 hover:border-slate-400 hover:text-slate-700"}`}>
                  {shareCopied ? "✓ 링크 복사됨!" : "🔗 전체 공유"}
                </button>
                <button onClick={toggleSplitMode}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition
                    ${splitMode
                      ? "bg-slate-700 text-white border-slate-700"
                      : "bg-white border-gray-200 text-gray-600 hover:border-slate-400 hover:text-slate-700"}`}>
                  {splitMode ? "✓ 분산 모드" : "👫 2인 분산"}
                </button>
              </div>

              {/* ── 2인 분산 패널 ── */}
              {splitMode && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {/* 내 몫 */}
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-extrabold text-blue-700">👤 내 몫 {myIdxs.size}게임</span>
                      <span className="text-xs text-blue-500 font-bold">{myIdxs.size * 1000}원</span>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {sets.filter(s => myIdxs.has(s.idx)).map(s => (
                        <div key={s.idx} className="flex gap-0.5 flex-wrap">
                          {s.numbers.map((n, i) => (
                            <span key={i} className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold
                              ${n<=10?"bg-[#FBC400] text-black":n<=20?"bg-[#069FDD] text-white":
                                n<=30?"bg-[#FF5757] text-white":n<=40?"bg-[#AAAAAA] text-white":"bg-[#B0D840] text-black"}`}>
                              {n}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => copyGroup(true)}
                        className="flex-1 py-1.5 text-[11px] font-bold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
                        복사
                      </button>
                      <button onClick={() => shareGroup(true)}
                        className="flex-1 py-1.5 text-[11px] font-bold bg-white border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition">
                        링크
                      </button>
                    </div>
                  </div>

                  {/* 상대방 몫 */}
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-extrabold text-rose-700">👥 상대 {sets.length - myIdxs.size}게임</span>
                      <span className="text-xs text-rose-500 font-bold">{(sets.length - myIdxs.size) * 1000}원</span>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {sets.filter(s => !myIdxs.has(s.idx)).map(s => (
                        <div key={s.idx} className="flex gap-0.5 flex-wrap">
                          {s.numbers.map((n, i) => (
                            <span key={i} className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold
                              ${n<=10?"bg-[#FBC400] text-black":n<=20?"bg-[#069FDD] text-white":
                                n<=30?"bg-[#FF5757] text-white":n<=40?"bg-[#AAAAAA] text-white":"bg-[#B0D840] text-black"}`}>
                              {n}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => copyGroup(false)}
                        className="flex-1 py-1.5 text-[11px] font-bold bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition">
                        복사
                      </button>
                      <button onClick={() => shareGroup(false)}
                        className="flex-1 py-1.5 text-[11px] font-bold bg-white border border-rose-300 text-rose-600 rounded-lg hover:bg-rose-50 transition">
                        링크
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between px-1 py-2 mt-3 text-sm text-gray-500">
                <span>총 <strong className="text-gray-800">{sets.length}장</strong></span>
                <span className="font-bold text-slate-600">= {sets.length * 1000}원</span>
              </div>
              <p className="text-center text-xs text-gray-300 pb-2">
                1,227회 통계 기반 · 당첨 보장 아님 😊
              </p>
            </>
          )}
        </>
      )}

    </div>
  );
}
