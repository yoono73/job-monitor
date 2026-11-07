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
  | "spread" | "recent10" | "midbias"
  | "tail_diversity" | "golden_zone" | "overdue_pick" | "triple_common";

interface BayesStat {
  number: number;
  posterior_mean: number;
  bayesian_rank: number;
}

interface PairStat {
  num_a: number;
  num_b: number;
  co_count: number;
  posterior_mean: number;
}

/* ─── 번호 진단 타입 ─── */
interface DiagCriterion {
  label: string;
  pass: boolean;
  detail: string;
  points: number;
}
interface DiagResult {
  score: number;
  criteria: DiagCriterion[];
  suggestion: Six | null; // AI 교체 번호
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

/* ── 최근 10회 핫번호 가중 (draws[0] = 최신) ── */
function genRecent10(draws: DrawRow[]): Six {
  if (draws.length === 0) return genRandom();
  const recent = draws.slice(0, 10);
  const freq = new Array(46).fill(1);
  recent.forEach(d => getNums(d).forEach(n => { freq[n] += 3; })); // 최근 10회 가중치 3배
  const sel: number[] = [];
  let pool = Array.from({ length: 45 }, (_, i) => i + 1);
  while (sel.length < 6) {
    const totalW = pool.reduce((s, n) => s + freq[n], 0);
    let r = Math.random() * totalW;
    for (const n of pool) { r -= freq[n]; if (r <= 0) { sel.push(n); pool = pool.filter(x => x !== n); break; } }
  }
  return sel.sort((a, b) => a - b) as Six;
}

/* ── 10-19 구간 가중 전략 ── */
function genMidBias(draws: DrawRow[]): Six {
  const freq = new Array(46).fill(1);
  draws.slice(0, 50).forEach(d => getNums(d).forEach(n => { freq[n]++; }));
  // 10-19 구간 가중치 1.5배 보강
  for (let n = 10; n <= 19; n++) freq[n] = Math.round(freq[n] * 1.5);
  for (let t = 0; t < 5000; t++) {
    const sel: number[] = [];
    let pool = Array.from({ length: 45 }, (_, i) => i + 1);
    while (sel.length < 6) {
      const totalW = pool.reduce((s, n) => s + freq[n], 0);
      let r = Math.random() * totalW;
      for (const n of pool) { r -= freq[n]; if (r <= 0) { sel.push(n); pool = pool.filter(x => x !== n); break; } }
    }
    const sorted = sel.sort((a, b) => a - b) as Six;
    if (isBalanced(sorted)) return sorted;
  }
  return genBalance();
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
  return sum >= 95 && sum <= 180 && (odd >= 2 && odd <= 5) && secs >= 3;
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

/* ── 끝자리 다양성 전략 (tail_diversity) ── */
function genTailDiversity(draws: DrawRow[]): Six {
  // 끝자리 4·3·1 우선 가중, 끝자리 0·6·9는 낮은 가중치, 6개 끝자리 모두 달라야 함
  const tailWeights: Record<number, number> = {0:0.7, 1:1.3, 2:1.1, 3:1.3, 4:1.4, 5:1.1, 6:0.7, 7:0.9, 8:0.8, 9:0.7};
  const freq = new Array(46).fill(1);
  draws.slice(0, 100).forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n => freq[n]++));
  for (let t = 0; t < 8000; t++) {
    const sel: number[] = [];
    const usedTails = new Set<number>();
    const pool = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5);
    for (const n of pool) {
      if (sel.length >= 6) break;
      const tail = n % 10;
      if (!usedTails.has(tail)) {
        const w = (freq[n] * tailWeights[tail]);
        if (Math.random() < w / (w + 3)) { sel.push(n); usedTails.add(tail); }
      }
    }
    if (sel.length === 6) { const s = sel.sort((a,b)=>a-b) as Six; if (isBalanced(s)) return s; }
  }
  // fallback: 끝자리 5개 이상만 달라도 OK
  for (let t = 0; t < 5000; t++) {
    const nums = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6);
    const tails = new Set(nums.map(n=>n%10));
    if (tails.size >= 5 && isBalanced(nums)) return nums.sort((a,b)=>a-b) as Six;
  }
  return genBalance();
}

/* ── 황금구간 전략 (golden_zone) ── */
function genGoldenZone(): Six {
  // 합계 120~155, 3저3고(1-22 vs 23-45), 연속쌍 1개
  for (let t = 0; t < 10000; t++) {
    const nums = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6);
    const sum = nums.reduce((a,b)=>a+b,0);
    const low = nums.filter(n=>n<=22).length;
    const sorted = nums.sort((a,b)=>a-b);
    const cons = sorted.slice(0,-1).filter((n,i)=>sorted[i+1]-n===1).length;
    if (sum>=120 && sum<=155 && (low===3) && cons===1) return sorted as Six;
  }
  // 조건 완화: 합계 110~165, 2~4저
  for (let t = 0; t < 5000; t++) {
    const nums = Array.from({length:45},(_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,6);
    const sum = nums.reduce((a,b)=>a+b,0);
    const low = nums.filter(n=>n<=22).length;
    if (sum>=110 && sum<=165 && low>=2 && low<=4) return nums.sort((a,b)=>a-b) as Six;
  }
  return genBalance();
}

/* ── 최장공백 우선 전략 (overdue_pick) ── */
function genOverduePick(draws: DrawRow[]): Six {
  if (draws.length === 0) return genRandom();
  // draws[0] = 최신 (내림차순)
  const lastSeen = new Array(46).fill(draws.length);
  draws.forEach((d,i) => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(n=>{
    if (lastSeen[n]===draws.length) lastSeen[n]=i;
  }));
  // 20회 이상 미출현 번호 우선 (없으면 10회 이상)
  const longAbsent = Array.from({length:45},(_,i)=>i+1).filter(n=>lastSeen[n]>=20);
  const midAbsent  = Array.from({length:45},(_,i)=>i+1).filter(n=>lastSeen[n]>=10);
  const candidates = longAbsent.length >= 3 ? longAbsent : midAbsent.length >= 3 ? midAbsent :
    Array.from({length:45},(_,i)=>i+1).sort((a,b)=>lastSeen[b]-lastSeen[a]).slice(0,12);
  for (let t = 0; t < 5000; t++) {
    const abCount = Math.min(candidates.length, Math.floor(Math.random()*2)+2); // 2~3개
    const picked = [...candidates].sort(()=>Math.random()-0.5).slice(0,abCount);
    const rest = Array.from({length:45},(_,i)=>i+1).filter(n=>!picked.includes(n))
      .sort(()=>Math.random()-0.5).slice(0,6-abCount);
    const nums = [...picked,...rest].sort((a,b)=>a-b) as Six;
    if (isBalanced(nums)) return nums;
  }
  return genBalance();
}

/* ── 3구간 공통 전략 (triple_common) ── */
function genTripleCommon(draws: DrawRow[]): Six {
  if (draws.length < 50) return genRandom();
  const getCounts = (n: number) => {
    const recent = draws.slice(0, Math.min(n, draws.length)); // draws는 최신순
    const counts = new Array(46).fill(0);
    recent.forEach(d => [d.n1,d.n2,d.n3,d.n4,d.n5,d.n6].forEach(num => counts[num]++));
    return { counts, total: recent.length };
  };
  const r50 = getCounts(50), r100 = getCounts(100), r200 = getCounts(200);
  const exp50 = (r50.total * 6) / 45;
  const exp100 = (r100.total * 6) / 45;
  const exp200 = (r200.total * 6) / 45;
  // 3구간 모두 평균 이상인 번호 = "공통 핫" 후보
  const triple = Array.from({length:45},(_,i)=>i+1).filter(
    n => r50.counts[n] >= exp50 && r100.counts[n] >= exp100 && r200.counts[n] >= exp200
  );
  // 2구간 공통도 fallback 후보로
  const two = Array.from({length:45},(_,i)=>i+1).filter(n=>{
    const c = (r50.counts[n]>=exp50?1:0)+(r100.counts[n]>=exp100?1:0)+(r200.counts[n]>=exp200?1:0);
    return c===2;
  });
  const hotPool = triple.length >= 4 ? triple : [...triple, ...two];
  const others = Array.from({length:45},(_,i)=>i+1).filter(n=>!hotPool.includes(n));
  for (let t = 0; t < 5000; t++) {
    const hotPick = Math.min(hotPool.length, Math.floor(Math.random()*2)+3); // 3~4개 핫 번호
    const picked = [...hotPool].sort(()=>Math.random()-0.5).slice(0, hotPick);
    const rest = [...others].sort(()=>Math.random()-0.5).slice(0, 6 - hotPick);
    const nums = [...picked, ...rest].sort((a,b)=>a-b) as Six;
    if (isBalanced(nums)) return nums;
  }
  return genBalance();
}

/* ── 고급 8조건 필터 자동 생성 ── */
function genAutoFilter(): Six {
  // AC값(Arithmetic Complexity): 모든 번호쌍 차이의 고유값 개수 - 5
  // 번호 분산성 지표 — 높을수록 번호가 골고루 퍼짐 (최대 14)
  const calcAC = (s: number[]) => {
    const diffs = new Set<number>();
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++)
        diffs.add(s[j] - s[i]);
    return diffs.size - 5;
  };
  const secOf = (n: number) => n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : n <= 40 ? 3 : 4;

  for (let t = 0; t < 80000; t++) {
    const nums = Array.from({ length: 45 }, (_, i) => i + 1).sort(() => Math.random() - 0.5).slice(0, 6);
    const s = nums.sort((a, b) => a - b) as Six;

    // 조건1: 합계 110~150 (기존 100~159보다 정밀)
    const sum = s.reduce((a, b) => a + b, 0);
    if (sum < 110 || sum > 150) continue;

    // 조건2: 홀수 3~4개
    const odd = s.filter(n => n % 2 === 1).length;
    if (odd < 3 || odd > 4) continue;

    // 조건3: 구간 3개 이상 (1-10 / 11-20 / 21-30 / 31-40 / 41-45)
    if (new Set(s.map(secOf)).size < 3) continue;

    // 조건4: 연속 1쌍 이상 (연속 없음은 드묾)
    const consArr: boolean[] = s.slice(0, -1).map((n, i) => s[i + 1] - n === 1);
    if (!consArr.some(Boolean)) continue;

    // 조건5: 3연속 없음 (1-2-3 패턴은 극히 드묾)
    let hasTriple = false;
    for (let i = 0; i < consArr.length - 1; i++)
      if (consArr[i] && consArr[i + 1]) { hasTriple = true; break; }
    if (hasTriple) continue;

    // 조건6: 끝자리 중복 ≤ 2개 (같은 일의자리 3개 이상 금지)
    const tailFreq = s.reduce((m, n) => { const t = n % 10; m[t] = (m[t] || 0) + 1; return m; }, {} as Record<number, number>);
    if (Math.max(...Object.values(tailFreq)) > 2) continue;

    // 조건7: 저번호(1~22) 2~4개 (극단적 편향 방지)
    const lowCnt = s.filter(n => n <= 22).length;
    if (lowCnt < 2 || lowCnt > 4) continue;

    // 조건8: AC값 ≥ 7 (번호 분산성)
    if (calcAC(s) < 7) continue;

    return s;
  }
  // fallback: 완화 조건
  for (let t = 0; t < 20000; t++) {
    const nums = Array.from({ length: 45 }, (_, i) => i + 1).sort(() => Math.random() - 0.5).slice(0, 6);
    const s = nums.sort((a, b) => a - b) as Six;
    const sum = s.reduce((a, b) => a + b, 0);
    const odd = s.filter(n => n % 2 === 1).length;
    if (sum >= 100 && sum <= 159 && odd >= 2 && odd <= 4) return s;
  }
  return genBalance();
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
  recent10:     { category: "통계기반", icon: "🔥", label: "최근10회",   desc: "최근 10회 고빈도 번호 3배 가중 · 단기 트렌드 집중" },
  midbias:      { category: "패턴기반", icon: "🎯", label: "중간대가중",  desc: "10-19 구간 1.5배 보강 · 통계 사각지대 공략" },
  tail_diversity:{ category: "통계기반", icon: "🔟", label: "끝자리다양성", desc: "끝자리 6종 분산 · 1248회 편향 데이터 반영" },
  golden_zone:  { category: "패턴기반", icon: "🥇", label: "황금구간",    desc: "합계 120~155 · 3저3고 · 연속쌍 1개 황금조건" },
  overdue_pick:  { category: "통계기반", icon: "⏳", label: "최장공백",    desc: "20회 이상 미출현 번호 2~3개 우선 포함" },
  triple_common: { category: "통계기반", icon: "🔥", label: "3구간공통",   desc: "최근 50·100·200회 모두 평균 이상 출현 번호 집중" },
};

// 새로 추가된 전략 (드롭다운에 NEW 표시) — 신규 전략이 생기면 여기에 키를 추가하세요
const NEW_KEYS: MethodKey[] = ["tail_diversity", "golden_zone", "overdue_pick", "triple_common"];

const CATEGORY_GROUPS = [
  { cat: "개인화",  keys: ["fav"] as MethodKey[] },
  { cat: "베이지안", keys: ["bayes", "bayes_overdue"] as MethodKey[] },
  { cat: "통계기반", keys: ["hot", "cold", "pairs", "carryover", "norepeat", "overdue", "recent20", "recent10", "tail_diversity", "overdue_pick", "triple_common"] as MethodKey[] },
  { cat: "패턴기반", keys: ["pattern", "hot_pattern", "cold_pattern", "ac", "prime", "midbias", "golden_zone"] as MethodKey[] },
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
    case "recent10":      return genRecent10(draws);
    case "midbias":       return genMidBias(draws);
    case "tail_diversity": return genTailDiversity(draws);
    case "golden_zone":   return genGoldenZone();
    case "overdue_pick":  return genOverduePick(draws);
    case "triple_common": return genTripleCommon(draws);
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
function ResultCard({ s, copied, saved, bought, onCopy, onSave, onBuy }: {
  s: LottoSet;
  copied: number | null;
  saved: Set<number>;
  bought: Set<number>;
  onCopy: (nums: Six, idx: number) => void;
  onSave: (s: LottoSet) => void;
  onBuy: (s: LottoSet) => void;
}) {
  const cc = CAT_COLOR[s.category] ?? CAT_COLOR["균형기반"];
  const isSaved = saved.has(s.idx);
  const isBought = bought.has(s.idx);
  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow
      ${isBought ? "border-orange-300 bg-orange-50/30" : isSaved ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200"}`}>
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
          <button
            onClick={() => !isBought && onBuy(s)}
            disabled={isBought}
            className={`text-xs px-2.5 py-1 rounded-lg border transition
              ${isBought
                ? "text-orange-600 border-orange-300 bg-orange-50 cursor-default"
                : "text-gray-400 border-gray-200 hover:text-orange-500 hover:border-orange-400"}`}
          >
            {isBought ? "🎫 구매됨" : "🎫 구매"}
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

/* ─── 번호 진단 로직 ─── */
function diagnosNumbers(nums: number[], draws: DrawRow[], bayesStats: BayesStat[], pairStats: PairStat[]): DiagResult {
  const sorted = [...nums].sort((a, b) => a - b);
  const criteria: DiagCriterion[] = [];

  // AC값 계산 헬퍼
  const calcDiagAC = (s: number[]) => {
    const diffs = new Set<number>();
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++)
        diffs.add(s[j] - s[i]);
    return diffs.size - 5;
  };

  // 1. 합계 황금구간 115~140 (15점) — 더 엄격한 핵심 구간
  const sum = sorted.reduce((s, n) => s + n, 0);
  const sumPass = sum >= 115 && sum <= 140;
  criteria.push({ label: "합계 핵심구간 (115~140)", pass: sumPass, detail: `합계 ${sum}`, points: 15 });

  // 2. 홀수 정확히 3개 (15점) — 완벽한 3:3 균형
  const oddCnt = sorted.filter(n => n % 2 === 1).length;
  const oePass = oddCnt === 3;
  criteria.push({ label: "홀짝 완벽 균형 (홀수 3개)", pass: oePass, detail: `홀수 ${oddCnt}개`, points: 15 });

  // 3. 3구간 완전 커버 (15점) - 구간: 1-15, 16-30, 31-45
  const secs = new Set(sorted.map(n => n <= 15 ? 1 : n <= 30 ? 2 : 3));
  const secPass = secs.size === 3;
  criteria.push({ label: "3구간 완전 커버 (1~15·16~30·31~45)", pass: secPass, detail: `${secs.size}구간`, points: 15 });

  // 4. 베이지안 상위 (평균 순위 < 23) (15점)
  let bayesScore = 0;
  if (bayesStats.length > 0) {
    const ranks = sorted.map(n => { const s = bayesStats.find(b => b.number === n); return s ? s.bayesian_rank : 45; });
    const avgRank = ranks.reduce((s, r) => s + r, 0) / ranks.length;
    bayesScore = avgRank;
    const bayesPass = avgRank < 18;
    criteria.push({ label: "베이지안 상위 (평균 순위 18위↑)", pass: bayesPass, detail: `평균 ${avgRank.toFixed(1)}위`, points: 15 });
  } else {
    criteria.push({ label: "베이지안 상위", pass: false, detail: "데이터 로딩 중", points: 15 });
  }

  // 5. 핫번호 포함 (최근 100회 상위 15개 중 1개 이상) (10점)
  let hotNums: number[] = [];
  if (draws.length >= 10) {
    const recent = draws.slice(0, Math.min(100, draws.length));
    const freq: Record<number, number> = {};
    for (const d of recent) getNums(d).forEach(n => { freq[n] = (freq[n] ?? 0) + 1; });
    hotNums = Object.entries(freq).sort(([, a], [, b]) => b - a).slice(0, 15).map(([n]) => +n);
  }
  const hotCnt = sorted.filter(n => hotNums.includes(n)).length;
  const hotPass = hotCnt >= 2;
  criteria.push({ label: "핫번호 2개↑ (최근 100회 상위 15)", pass: hotPass, detail: `${hotCnt}개 포함`, points: 10 });

  // 6. 연속번호 정확히 1쌍 (10점) — 0쌍/2쌍 이상 모두 탈락
  let consPairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) consPairs++;
  }
  const consPass = consPairs === 1;
  criteria.push({ label: "연속번호 정확히 1쌍", pass: consPass, detail: `${consPairs}쌍`, points: 10 });

  // 7. 끝자리 5종 이상 (10점) — 더 엄격
  const tails = new Set(sorted.map(n => n % 10));
  const tailPass = tails.size >= 5;
  criteria.push({ label: "끝자리 다양성 (5종 이상)", pass: tailPass, detail: `${tails.size}종`, points: 10 });

  // 8. AC값 8 이상 (10점) — 번호 분산성 고급 기준
  const acVal = calcDiagAC(sorted);
  const acPass = acVal >= 8;
  criteria.push({ label: "AC값 ≥8 (번호 분산성 우수)", pass: acPass, detail: `AC=${acVal}`, points: 10 });

  // 9. 상위 페어 3개↑ (10점) — 베이지안 상위 100쌍 중 3개 이상 포함
  if (pairStats.length > 0) {
    const myPairs: string[] = [];
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++)
        myPairs.push(`${sorted[i]}-${sorted[j]}`);
    const topPairKeys = new Set(pairStats.map(p =>
      `${Math.min(p.num_a, p.num_b)}-${Math.max(p.num_a, p.num_b)}`));
    const pairHits = myPairs.filter(k => topPairKeys.has(k)).length;
    const pairPass = pairHits >= 3;
    criteria.push({ label: "상위 페어 3개↑ (궁합 좋은 쌍)", pass: pairPass, detail: `${pairHits}/15쌍 매칭`, points: 10 });
  } else {
    criteria.push({ label: "상위 페어 3개↑ (궁합 좋은 쌍)", pass: false, detail: "데이터 로딩 중", points: 10 });
  }

  const score = criteria.reduce((s, c) => c.pass ? s + c.points : s, 0);

  // AI 교체 제안 (점수 < 55점이면)
  let suggestion: Six | null = null;
  if (score < 55 && draws.length >= 10) {
    // 균형선택 전략으로 교체 번호 생성
    suggestion = genBalance();
  }

  return { score, criteria, suggestion };
}

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
  const [boughtSets, setBoughtSets] = useState<Set<number>>(new Set());
  const [saveMsg,   setSaveMsg] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [myIdxs,    setMyIdxs]   = useState<Set<number>>(new Set());
  const [shareCopied, setShareCopied] = useState(false);

  const [setCount,    setSetCount]   = useState(5);
  const [methodKeys,  setMethodKeys] = useState<MethodKey[]>(DEFAULT_KEYS.slice(0, 5));
  const [myPickMode,  setMyPickMode] = useState(false);
  const [myPickNums,  setMyPickNums] = useState<Set<number>>(new Set());
  const [showMyPickPanel, setShowMyPickPanel] = useState(false);
  const [bayesStats,  setBayesStats] = useState<BayesStat[]>([]);
  const [pairStats,   setPairStats]  = useState<PairStat[]>([]);

  // 번호 진단
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const [diagNums,      setDiagNums]      = useState<Set<number>>(new Set());
  const [diagResult,    setDiagResult]    = useState<DiagResult | null>(null);

  // 조건 필터 자동 생성
  const [showAutoFilter,      setShowAutoFilter]      = useState(false);
  const [autoFilterCount,     setAutoFilterCount]     = useState(3);
  const [autoFilterSets,      setAutoFilterSets]      = useState<LottoSet[] | null>(null);
  const [autoFilterBusy,      setAutoFilterBusy]      = useState(false);
  const [autoFilterDiagMap,   setAutoFilterDiagMap]   = useState<Record<number, DiagResult>>({});

  const toggleDiagNum = (n: number) => {
    setDiagNums(prev => {
      const next = new Set(prev);
      if (next.has(n)) { next.delete(n); }
      else if (next.size < 6) { next.add(n); }
      setDiagResult(null);
      return next;
    });
  };

  const runDiagnosis = () => {
    if (diagNums.size !== 6) return;
    const result = diagnosNumbers(Array.from(diagNums), draws, bayesStats, pairStats);
    setDiagResult(result);
  };

  const useSuggestion = (nums: Six) => {
    setDiagNums(new Set(nums));
    setDiagResult(null);
  };

  const regenDiag = () => {
    // 조건 통과 번호로 자동 교체 후 재진단
    const nums = genAutoFilter();
    setDiagNums(new Set(nums));
    const result = diagnosNumbers(Array.from(nums), draws, bayesStats, pairStats);
    setDiagResult(result);
  };

  const runAutoFilter = () => {
    setAutoFilterBusy(true);
    setAutoFilterSets(null);
    setAutoFilterDiagMap({});
    setTimeout(() => {
      const newSets: LottoSet[] = Array.from({ length: autoFilterCount }, (_, i) => ({
        idx: i + 1,
        icon: "🎯",
        method: "조건필터",
        category: "패턴기반",
        numbers: genAutoFilter(),
        desc: "8조건 동시 통과",
      }));
      setAutoFilterSets(newSets);
      setAutoFilterBusy(false);
    }, 500);
  };

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

    supabase.from("lotto_pair_stats")
      .select("num_a,num_b,co_count,posterior_mean")
      .order("posterior_mean", { ascending: false })
      .limit(100)
      .then(({ data }) => { if (data) setPairStats(data as PairStat[]); });

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

  const switchTab = (mom: boolean) => { setShowMom(mom); setSets(null); setSavedSets(new Set()); setBoughtSets(new Set()); };

  /* 구매 이력 저장 */
  const buyRecord = useCallback(async (s: LottoSet) => {
    if (!nextDrawNo) return;
    const { error } = await supabase.from("recommendation_history").insert({
      draw_no:  nextDrawNo,
      strategy: s.method,
      numbers:  s.numbers,
      note:     s.desc,
    });
    if (!error) {
      setBoughtSets(prev => new Set([...prev, s.idx]));
      setSaveMsg(`${nextDrawNo}회차 구매 기록됐어요 🎫`);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }, [nextDrawNo, supabase]);

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
    setMethodKeys(() => {
      // 대량 모드: DEFAULT_KEYS를 순환하여 n개 채우기
      const keys: MethodKey[] = [];
      for (let i = 0; i < n; i++) keys.push(DEFAULT_KEYS[i % DEFAULT_KEYS.length]);
      return keys;
    });
    setSets(null);
    if (n !== 10) { setMyPickMode(false); setShowMyPickPanel(false); setMyPickNums(new Set()); }
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
    setShowMyPickPanel(false); setMyPickNums(new Set());
    setTimeout(() => {
      const usedNums = new Set<number>();
      const genCount = myPickMode ? setCount - 1 : setCount;
      const generatedSets = methodKeys.slice(0, genCount).map((key, i) => {
        const numbers = runGenerator(key, draws, bayesStats, favorites, usedNums);
        numbers.forEach(n => usedNums.add(n));
        return { idx: i + 1, ...METHODS[key], method: METHODS[key].label, numbers };
      });
      setSets(generatedSets);
      if (myPickMode) setShowMyPickPanel(true);
      setBusy(false);
    }, 700);
  }, [draws, ready, busy, methodKeys, bayesStats, myPickMode, setCount]);

  const toggleMyPickNum = (n: number) => {
    setMyPickNums(prev => {
      const next = new Set(prev);
      if (next.has(n)) { next.delete(n); return next; }
      if (next.size >= 6) return prev;
      next.add(n); return next;
    });
  };

  const completeMyPick = () => {
    if (myPickNums.size !== 6 || !sets) return;
    const nums = Array.from(myPickNums).sort((a, b) => a - b) as Six;
    const newSet: LottoSet = {
      idx: setCount, icon: "✋", method: "내 픽",
      category: "직접픽", desc: "내가 직접 선택", numbers: nums,
    };
    setSets(prev => prev ? [...prev, newSet] : [newSet]);
    setShowMyPickPanel(false);
  };

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

      {/* ━━━ 📢 최근 업데이트 공지 ━━━ */}
      <div className="mb-5 border border-blue-200 rounded-2xl bg-blue-50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">📢</span>
          <h3 className="text-sm font-bold text-blue-800">최근 업데이트</h3>
          <span className="ml-auto text-[11px] text-blue-400 font-mono">2026-11-01</span>
        </div>
        <ul className="space-y-1.5 text-xs text-blue-700">
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">🔍</span>
            <span>
              <span className="font-semibold">번호 진단</span> 신규 —{" "}
              6개 번호를 직접 입력하면 <span className="font-semibold text-indigo-700">종합 점수(0~100)</span>와 8가지 통계 기준으로 분석해줍니다.
              낮은 점수면 AI 교체 번호까지 제안해요.
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">📊</span>
            <span>
              <span className="font-semibold">전략 백테스팅</span> —{" "}
              통계 탭에서 최근 200회 시뮬레이션 결과를 확인하고, <span className="font-semibold text-amber-700">1위 전략을 직접 선택</span>해 생성하세요.
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 text-blue-400 shrink-0">✓</span>
            <span><span className="font-semibold">대량 생성</span> — 10·20·30·50세트(5만원치) 전략 자동 순환 지원</span>
          </li>
        </ul>
      </div>

      {/* ━━━ 🔍 번호 진단 ━━━ */}
      <div className="mb-5">
        <button
          onClick={() => { setShowDiagnosis(v => !v); setDiagNums(new Set()); setDiagResult(null); }}
          className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl hover:from-indigo-100 hover:to-violet-100 transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <div className="text-left">
              <div className="text-sm font-bold text-indigo-800">번호 진단</div>
              <div className="text-[11px] text-indigo-500">6개 번호 입력 → 통계 기반 점수 분석</div>
            </div>
            <span className="bg-indigo-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">NEW</span>
          </div>
          <span className="text-indigo-400 text-lg">{showDiagnosis ? "▲" : "▼"}</span>
        </button>

        {showDiagnosis && (
          <div className="mt-2 bg-white border border-indigo-200 rounded-2xl p-4 shadow-sm">
            {/* 번호 선택 안내 */}
            <p className="text-xs text-gray-500 mb-3">
              진단할 번호 6개를 선택하세요.
              <span className="ml-1 font-semibold text-indigo-600">({diagNums.size}/6)</span>
            </p>

            {/* 1~45 번호 그리드 */}
            <div className="grid grid-cols-9 gap-1 mb-4">
              {Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
                const sel = diagNums.has(n);
                return (
                  <button
                    key={n}
                    onClick={() => toggleDiagNum(n)}
                    className={`
                      w-full aspect-square rounded-full text-[11px] font-bold transition-all
                      ${sel
                        ? ballColor(n) + " shadow-md scale-110"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }
                      ${!sel && diagNums.size >= 6 ? "opacity-30 cursor-not-allowed" : ""}
                    `}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            {/* 선택된 번호 표시 */}
            {diagNums.size > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {Array.from(diagNums).sort((a, b) => a - b).map(n => <Ball key={n} n={n} />)}
              </div>
            )}

            {/* 진단하기 / 초기화 버튼 */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={runDiagnosis}
                disabled={diagNums.size !== 6}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all
                  ${diagNums.size === 6
                    ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
              >
                {diagNums.size === 6 ? "🔍 진단하기" : `${6 - diagNums.size}개 더 선택하세요`}
              </button>
              {diagNums.size > 0 && (
                <button
                  onClick={() => { setDiagNums(new Set()); setDiagResult(null); }}
                  className="px-4 py-2.5 rounded-xl font-bold text-sm bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all shrink-0"
                >
                  🔄 초기화
                </button>
              )}
            </div>

            {/* 진단 결과 */}
            {diagResult && (
              <div className="space-y-3">
                {/* 종합 점수 */}
                <div className={`rounded-xl p-4 text-center border-2
                  ${diagResult.score >= 70 ? "bg-emerald-50 border-emerald-300" :
                    diagResult.score >= 50 ? "bg-amber-50 border-amber-300" :
                    "bg-rose-50 border-rose-300"}`}>
                  <div className={`text-4xl font-extrabold mb-1
                    ${diagResult.score >= 70 ? "text-emerald-600" :
                      diagResult.score >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                    {diagResult.score}점
                  </div>
                  <div className="text-sm font-semibold text-gray-600">
                    {diagResult.score >= 70 ? "✅ 우수 — 이 번호로 생성해보세요!" :
                     diagResult.score >= 50 ? "⚠️ 보통 — 사용 가능하지만 개선 여지 있음" :
                     "❌ 미흡 — AI 추천 번호로 교체를 권장합니다"}
                  </div>
                </div>

                {/* 기준별 결과 */}
                <div className="space-y-1.5">
                  {diagResult.criteria.map((c, i) => (
                    <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2
                      ${c.pass ? "bg-emerald-50" : "bg-gray-50"}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{c.pass ? "✅" : "❌"}</span>
                        <span className="text-xs font-medium text-gray-700">{c.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-gray-400">{c.detail}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full
                          ${c.pass ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
                          +{c.points}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 점수 낮을 때 재생성 옵션 */}
                {diagResult.score < 70 && (
                  <div className="space-y-2">
                    <button
                      onClick={regenDiag}
                      className="w-full py-2.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-md"
                    >
                      🎯 4조건 통과 번호로 자동 교체 + 재진단
                    </button>
                    {diagResult.suggestion && (
                      <button
                        onClick={() => useSuggestion(diagResult.suggestion!)}
                        className="w-full py-2 rounded-xl text-sm font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition"
                      >
                        🤖 AI 추천 번호로 교체
                      </button>
                    )}
                  </div>
                )}

                {/* 확정 생성 버튼 */}
                {diagResult.score >= 50 && (
                  <button
                    onClick={() => {
                      const nums = Array.from(diagNums).sort((a, b) => a - b) as Six;
                      setSets([{ idx: 1, icon: "🔍", method: "번호진단", category: "직접픽", desc: `진단점수 ${diagResult.score}점`, numbers: nums }]);
                      setSavedSets(new Set());
                      setShowDiagnosis(false);
                      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                    }}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition shadow-md"
                  >
                    ✅ 이 번호로 생성하기
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ━━━ 🎯 조건 필터 자동 생성 ━━━ */}
      <div className="mb-5">
        <button
          onClick={() => { setShowAutoFilter(v => !v); setAutoFilterSets(null); }}
          className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl hover:from-emerald-100 hover:to-teal-100 transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <div className="text-left">
              <div className="text-sm font-bold text-emerald-800">조건 필터 자동 생성</div>
              <div className="text-[11px] text-emerald-500">8조건 동시 통과 번호만 자동 추출</div>
            </div>
            <span className="bg-emerald-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">NEW</span>
          </div>
          <span className="text-emerald-400 text-lg">{showAutoFilter ? "▲" : "▼"}</span>
        </button>

        {showAutoFilter && (
          <div className="mt-2 bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
            {/* 8조건 설명 */}
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {[
                { icon: "📊", label: "합계 110~150",   rate: "~45%",  tip: "좁은 황금구간" },
                { icon: "⚖️", label: "홀수 3~4개",     rate: "60%",   tip: "홀짝 균형" },
                { icon: "📍", label: "구간 3개+",      rate: "96.9%", tip: "번호 분포" },
                { icon: "🔗", label: "연속 1~2쌍",     rate: "~48%",  tip: "3연속 제외" },
                { icon: "🔢", label: "끝자리 중복≤2",  rate: "~80%",  tip: "일의자리 분산" },
                { icon: "⬇️", label: "저번호 2~4개",   rate: "~75%",  tip: "1~22 균형" },
                { icon: "📐", label: "AC값 ≥7",        rate: "~65%",  tip: "번호 분산성" },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-1.5 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                  <span className="text-sm">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-emerald-800">{c.label}</div>
                    <div className="text-[9px] text-emerald-500">{c.tip}</div>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 shrink-0">{c.rate}</span>
                </div>
              ))}
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-4 text-center">
              <span className="text-xs font-bold text-red-700">8조건 동시 통과: </span>
              <span className="text-base font-extrabold text-red-800">~4~5%</span>
              <span className="text-xs text-red-600"> (1,000회 중 40~50회만 통과)</span>
            </div>

            {/* 세트 수 선택 */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-semibold text-gray-600 shrink-0">세트 수</span>
              <div className="flex gap-1.5 flex-wrap">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setAutoFilterCount(n)}
                    className={`w-9 h-9 rounded-full font-bold text-sm transition-all
                      ${autoFilterCount === n
                        ? "bg-emerald-600 text-white shadow-md"
                        : "bg-gray-100 text-gray-500 hover:bg-emerald-50 hover:text-emerald-700"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* 생성 버튼 */}
            <button
              onClick={runAutoFilter}
              disabled={autoFilterBusy}
              className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all mb-4
                ${autoFilterBusy
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md"}`}
            >
              {autoFilterBusy ? "⏳ 생성 중..." : `🎯 ${autoFilterCount}세트 생성하기`}
            </button>

            {/* 결과 */}
            {autoFilterSets && (
              <div className="space-y-3">
                {autoFilterSets.map(s => {
                  const sorted = [...s.numbers];
                  const sum = sorted.reduce((a, b) => a + b, 0);
                  const odd = sorted.filter(n => n % 2 === 1).length;
                  const hasCons = sorted.slice(0, -1).some((n, i) => sorted[i + 1] - n === 1);
                  return (
                    <div key={s.idx} className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-emerald-700">세트 {s.idx}</span>
                        <div className="flex gap-1.5 text-[10px]">
                          <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">합 {sum}</span>
                          <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">홀 {odd}개</span>
                          {hasCons && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">연속 ✓</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        {s.numbers.map((n, i) => <Ball key={i} n={n} />)}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { navigator.clipboard.writeText(s.numbers.join("  ")); }}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition"
                        >
                          복사
                        </button>
                        <button
                          onClick={() => {
                            if (autoFilterDiagMap[s.idx]) {
                              // 이미 진단됐으면 토글 (닫기)
                              setAutoFilterDiagMap(prev => {
                                const next = { ...prev };
                                delete next[s.idx];
                                return next;
                              });
                            } else {
                              const result = diagnosNumbers(s.numbers, draws, bayesStats, pairStats);
                              setAutoFilterDiagMap(prev => ({ ...prev, [s.idx]: result }));
                            }
                          }}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition
                            ${autoFilterDiagMap[s.idx]
                              ? "bg-indigo-100 text-indigo-700 border border-indigo-300"
                              : "bg-indigo-600 text-white hover:bg-indigo-700"}`}
                        >
                          {autoFilterDiagMap[s.idx] ? "▲ 접기" : "🔍 진단하기"}
                        </button>
                        <button
                          onClick={() => {
                            setSets([{ idx: 1, icon: "🎯", method: "조건필터", category: "패턴기반", desc: "8조건 통과", numbers: s.numbers }]);
                            setSavedSets(new Set());
                            window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                          }}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                        >
                          ✅ 사용하기
                        </button>
                      </div>

                      {/* ▼ 인라인 진단 결과 */}
                      {autoFilterDiagMap[s.idx] && (() => {
                        const dr = autoFilterDiagMap[s.idx];
                        return (
                          <div className="mt-3 pt-3 border-t border-emerald-200">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-indigo-700">🔍 진단 결과</span>
                              <span className={`text-sm font-extrabold ${dr.score >= 70 ? "text-green-600" : dr.score >= 50 ? "text-yellow-600" : "text-red-500"}`}>
                                {dr.score}점
                              </span>
                            </div>
                            <div className="space-y-1">
                              {dr.criteria.map((c, ci) => (
                                <div key={ci} className="flex items-start gap-1.5 text-[11px]">
                                  <span>{c.pass ? "✅" : "❌"}</span>
                                  <span className={c.pass ? "text-gray-700" : "text-gray-400"}>{c.label}</span>
                                  <span className="ml-auto text-gray-400 shrink-0">{c.pass ? `+${c.points}` : "0"}점</span>
                                </div>
                              ))}
                            </div>
                            {dr.score >= 50 && (
                              <button
                                onClick={() => {
                                  setSets([{ idx: 1, icon: "🎯", method: "조건필터", category: "패턴기반", desc: `8조건+진단 ${dr.score}점`, numbers: s.numbers }]);
                                  setSavedSets(new Set());
                                  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                                }}
                                className="mt-2 w-full py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                              >
                                ✅ 이 번호 사용하기
                              </button>
                            )}
                          </div>
                        );
                      })()}

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
                {sets.map(s => <ResultCard key={s.idx} s={s} copied={copied} saved={savedSets} bought={boughtSets} onCopy={copy} onSave={saveSet} onBuy={buyRecord} />)}
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
            <p className="text-xs font-bold text-gray-500 mb-2">세트 수 선택</p>
            {/* 개별 선택 1-5 */}
            <p className="text-[10px] text-gray-400 font-semibold mb-1.5">개별 설정</p>
            <div className="flex gap-2 mb-3">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => updateSetCount(n)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all
                    ${setCount === n
                      ? "bg-slate-700 text-white shadow-sm"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {n}
                </button>
              ))}
            </div>
            {/* 대량 선택 */}
            <p className="text-[10px] text-gray-400 font-semibold mb-1.5">대량 구매 패키지</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { n: 10, price: "1만원", color: "slate" },
                { n: 20, price: "2만원", color: "teal" },
                { n: 30, price: "3만원", color: "indigo" },
                { n: 50, price: "5만원", color: "rose" },
              ].map(({ n, price, color }) => {
                const active = setCount === n;
                const cls = {
                  slate: active ? "bg-slate-700 text-white border-slate-700" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
                  teal:  active ? "bg-teal-600 text-white border-teal-600"   : "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100",
                  indigo: active ? "bg-indigo-600 text-white border-indigo-600" : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
                  rose:  active ? "bg-rose-600 text-white border-rose-600"   : "bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100",
                }[color];
                return (
                  <button key={n} onClick={() => updateSetCount(n)}
                    className={`py-2.5 rounded-xl border font-bold transition-all text-center ${cls}`}>
                    <div className="text-base leading-tight">{n}세트</div>
                    <div className={`text-[10px] font-semibold ${active ? "text-white/80" : "opacity-60"}`}>{price}</div>
                  </button>
                );
              })}
            </div>
            {setCount === 10 && (
              <button
                onClick={() => { setMyPickMode(v => !v); setSets(null); setShowMyPickPanel(false); setMyPickNums(new Set()); }}
                className={`mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all border
                  ${myPickMode
                    ? "bg-violet-600 text-white border-violet-700"
                    : "bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100"}`}
              >
                <span>✋</span>
                <span>{myPickMode ? "내 픽 모드 ON — 9세트 생성 후 직접 선택" : "내 픽 모드 — 마지막 세트를 직접 고르기"}</span>
              </button>
            )}
          </div>

          {/* 세트별 방식 선택 */}
          {/* 대량 모드(>10세트): 전략 자동 순환 안내 */}
          {setCount > 10 && (
            <div className="bg-gradient-to-r from-indigo-50 to-teal-50 border border-indigo-200 rounded-2xl p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-extrabold text-indigo-700">🔄 전략 자동 순환</span>
                <span className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full">{setCount}세트</span>
              </div>
              <p className="text-[11px] text-indigo-600 mb-2">
                {setCount}세트는 아래 {DEFAULT_KEYS.length}개 전략을 균등하게 순환하여 생성합니다.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_KEYS.map((k, i) => {
                  const m = METHODS[k];
                  const cc = CAT_COLOR[m.category];
                  return (
                    <span key={k} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cc.badge} ${cc.border}`}>
                      {m.icon} {m.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-2 mb-4">
            {setCount <= 10 && Array.from({ length: setCount }).map((_, i) => {
              const isMyPickSlot = myPickMode && i === setCount - 1;
              if (isMyPickSlot) {
                return (
                  <div key={i} className="flex items-center gap-3 bg-violet-50 border border-violet-300 rounded-xl px-4 py-3">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-violet-600 text-white">
                      {i + 1}세트
                    </span>
                    <span className="text-base shrink-0">✋</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-violet-700">내 픽</p>
                      <p className="text-[11px] text-violet-400">생성 후 번호 풀에서 직접 선택</p>
                    </div>
                  </div>
                );
              }
              const key = methodKeys[i] ?? "random";
              const m = METHODS[key];
              const cc = CAT_COLOR[m.category];
              return (
                <div key={i} className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 ${cc.border}`}>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cc.badge}`}>
                    {i + 1}세트
                  </span>
                  <span className="text-base shrink-0">{m.icon}</span>
                  {NEW_KEYS.includes(key) && (
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-rose-500 text-white shrink-0">NEW</span>
                  )}
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
                              {NEW_KEYS.includes(k) ? "🆕 NEW · " : ""}{METHODS[k].icon} {METHODS[k].label} — {METHODS[k].desc}
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

          {/* ✋ 내 픽 번호 풀 패널 */}
          {showMyPickPanel && sets && (
            <div className="bg-violet-50 border border-violet-300 rounded-2xl p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-extrabold text-violet-700">✋ 내 픽 — {setCount}번째 세트</p>
                  <p className="text-[11px] text-violet-500 mt-0.5">
                    9세트에 나온 번호는 <span className="font-bold text-violet-700">보라색</span>으로 표시돼요 · 6개 선택
                    <span className="ml-2 font-bold text-violet-800">({myPickNums.size}/6)</span>
                  </p>
                </div>
                {myPickNums.size > 0 && (
                  <button onClick={() => setMyPickNums(new Set())}
                    className="text-[11px] text-violet-400 hover:text-violet-600 underline shrink-0">
                    초기화
                  </button>
                )}
              </div>
              {/* 번호 풀 (1~45) */}
              {(() => {
                const poolNums = new Set(sets.flatMap(s => s.numbers));
                return (
                  <div className="grid grid-cols-9 gap-1.5">
                    {Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
                      const inPool = poolNums.has(n);
                      const selected = myPickNums.has(n);
                      return (
                        <button key={n} onClick={() => toggleMyPickNum(n)}
                          className={`aspect-square rounded-lg text-xs font-bold transition-all
                            ${selected
                              ? "bg-violet-600 text-white shadow-md scale-105"
                              : inPool
                                ? "bg-violet-200 text-violet-800 hover:bg-violet-300"
                                : "bg-white text-gray-400 border border-gray-200 hover:bg-gray-100"
                            }`}>
                          {n}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              {/* 선택된 번호 미리보기 */}
              {myPickNums.size > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Array.from(myPickNums).sort((a, b) => a - b).map(n => (
                    <span key={n} className="px-2.5 py-1 rounded-full bg-violet-600 text-white text-xs font-bold">{n}</span>
                  ))}
                </div>
              )}
              <button
                onClick={completeMyPick}
                disabled={myPickNums.size !== 6}
                className="mt-3 w-full py-3 rounded-xl font-bold text-sm transition-all
                  bg-violet-600 hover:bg-violet-700 text-white
                  disabled:opacity-40 disabled:cursor-not-allowed">
                {myPickNums.size === 6 ? `✅ ${setCount}번째 세트 완성하기` : `${6 - myPickNums.size}개 더 선택하세요`}
              </button>
            </div>
          )}

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
                    <ResultCard s={s} copied={copied} saved={savedSets} bought={boughtSets} onCopy={copy} onSave={saveSet} onBuy={buyRecord} />
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
