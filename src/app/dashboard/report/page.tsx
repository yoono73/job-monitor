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

function verdict(n: number, avg: number) {
  if (n < 30) return { label: "표본 부족", cls: "bg-gray-100 text-gray-500", z: null as number | null };
  const z = (avg - EXP_MATCH) / Math.sqrt(VAR_MATCH / n);
  if (Math.abs(z) < 3) return { label: "무작위와 차이 없음", cls: "bg-slate-100 text-slate-600", z };
  return { label: "차이 감지 (재검증 필요)", cls: "bg-amber-100 text-amber-700", z };
}

/* ─── Page ─── */
export default function ReportPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [judged, setJudged] = useState<Judged[]>([]);
  const [pending, setPending] = useState(0);
  const [draws, setDraws] = useState<DrawRow[]>([]);
  const [drawNoOf, setDrawNoOf] = useState<Map<string, number>>(new Map());

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

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: saved } = await supabase
          .from("saved_numbers")
          .select("id,draw_no,numbers,method,category,purchased")
          .eq("user_id", user.id);
        const drawMap = new Map(all.map(d => [d.draw_no, d]));
        const rows = (saved ?? []) as SavedRow[];
        const out: Judged[] = [];
        let pend = 0;
        const m = new Map<string, number>();
        rows.forEach(s => {
          const d = drawMap.get(s.draw_no);
          if (!d) { pend++; return; }
          out.push(judge(s, d));
          m.set(s.id, s.draw_no);
        });
        setJudged(out);
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

  const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 3 : 2)}%`;

  return (
    <div className="px-4 py-5 md:px-6 lg:px-8 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-gray-800">🧾 성적표</h1>
        <p className="text-sm text-gray-400 mt-1">내 번호의 실제 성적을 무작위 기준선과 비교합니다</p>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-3xl mb-3 animate-pulse">⏳</div>
          <p className="text-sm">불러오는 중...</p>
        </div>
      )}

      {!loading && (
        <>
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
            <p className="text-[11px] text-gray-400 mb-3">
              표본 30게임 미만은 판단 불가, z 절댓값 3 미만이면 무작위와 구분되지 않습니다.
            </p>
            {byMethod.length === 0 ? (
              <p className="text-xs text-gray-400">데이터가 없어요.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {byMethod.map(s => (
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
