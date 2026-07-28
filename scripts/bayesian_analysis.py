#!/usr/bin/env python3
"""
로또 베이지안 통계 분석 v1.0
─────────────────────────────────────────────────────────
모델:
  • Dirichlet-Multinomial  — 번호별 사후확률 + 95% 신뢰구간
  • 시간 지수감쇠 가중치   — λ=0.998, 최신 회차에 더 높은 비중
  • Beta-Binomial          — 번호쌍 결합사후확률
  • 카이제곱 검정          — 균등분포(공정성) 통계 검증
─────────────────────────────────────────────────────────
"""

import math
import json
import numpy as np
import urllib.request
from datetime import datetime

# ══ 설정 ════════════════════════════════════════════════════
SUPABASE_URL = "https://qwrnwymojurhtzcqpfma.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3cm53eW1vanVyaHR6Y3FwZm1hIiwic"
    "m9sZSI6ImFub24iLCJpYXQiOjE3ODA5OTg0NjIsImV4cCI6MjA5NjU3NDQ2Mn0"
    ".DTLwKm8j2JLtMqvvnfqvJmrcYWeA2UP3kdC5vbLuiJo"
)
DECAY_LAMBDA  = 0.998   # 시간 감쇠 계수 (1227회 기준 최신/과거 가중치 비 ≈ 11.7배)
TOP_PAIRS     = 300     # 저장할 상위 번호쌍 수
ALPHA_PRIOR   = 1.0     # Dirichlet 사전분포 파라미터 (무정보적 균등 사전)

# ══ 수학 유틸리티 (scipy 불필요) ════════════════════════════

def _reg_lower_gamma(a: float, x: float, max_iter: int = 300) -> float:
    """정규화 하위 불완전 감마함수 P(a, x) — 카이제곱 CDF 계산용"""
    if x <= 0:
        return 0.0
    lga = math.lgamma(a)
    if x < a + 1:
        # 급수 전개
        ap = a; val = s = 1.0 / a
        for _ in range(max_iter):
            ap += 1; val *= x / ap; s += val
            if abs(val) < abs(s) * 1e-12:
                break
        return min(1.0, s * math.exp(-x + a * math.log(x) - lga))
    else:
        # 연분수 전개 (Lentz 알고리즘)
        EPS = 1e-300
        b = x + 1 - a; c = 1.0 / EPS; d = 1.0 / b if abs(b) > EPS else 1 / EPS
        h = d
        for i in range(1, max_iter + 1):
            an = -i * (i - a); b += 2
            d = an * d + b;  d = EPS if abs(d) < EPS else d
            c = b + an / c;  c = EPS if abs(c) < EPS else c
            d = 1.0 / d; h *= d * c
            if abs(d * c - 1.0) < 1e-12:
                break
        return max(0.0, 1.0 - math.exp(-x + a * math.log(x) - lga) * h)

def chi2_pvalue(stat: float, df: int) -> float:
    """카이제곱 검정 p-값"""
    return 1.0 - _reg_lower_gamma(df / 2.0, stat / 2.0)

def _beta_cf(x: float, a: float, b: float, max_iter: int = 200) -> float:
    """불완전 베타함수 내부 연분수 계산"""
    EPS = 1e-300
    qab = a + b; qap = a + 1; qam = a - 1
    c = 1.0; d = 1 - qab * x / qap
    d = EPS if abs(d) < EPS else d
    d, h = 1.0 / d, 1.0 / d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d; d = EPS if abs(d) < EPS else d
        c = 1 + aa / c; c = EPS if abs(c) < EPS else c
        d = 1.0 / d; h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d; d = EPS if abs(d) < EPS else d
        c = 1 + aa / c; c = EPS if abs(c) < EPS else c
        d = 1.0 / d; h *= d * c
        if abs(d * c - 1.0) < 1e-10:
            break
    return h

def beta_cdf(x: float, a: float, b: float) -> float:
    """정규화 불완전 베타함수 I_x(a, b)"""
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    if x < (a + 1) / (a + b + 2):
        front = math.exp(a * math.log(x) + b * math.log(1 - x) - lbeta)
        return front * _beta_cf(x, a, b) / a
    else:
        front = math.exp(b * math.log(1 - x) + a * math.log(x) - lbeta)
        return 1.0 - front * _beta_cf(1 - x, b, a) / b

def beta_ppf(p: float, a: float, b: float, tol: float = 1e-9) -> float:
    """Beta 분포 분위수 — 이분법 탐색"""
    lo, hi = 0.0, 1.0
    for _ in range(120):
        mid = (lo + hi) / 2
        (lo if beta_cdf(mid, a, b) < p else hi).__class__  # dummy
        if beta_cdf(mid, a, b) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break
    return (lo + hi) / 2

# ══ Supabase REST API ════════════════════════════════════════

def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

def sb_get(table: str, select: str = "*", limit: int = 10000, order: str = "draw_no.asc"):
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}&limit={limit}&order={order}"
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_post(table: str, data):
    body = json.dumps(data if isinstance(data, list) else [data]).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=body, headers=_headers()
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# ══ 메인 분석 ════════════════════════════════════════════════

def run():
    print("=" * 55)
    print("  로또 베이지안 분석 v1.0")
    print(f"  실행 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 55)

    # ── 1. 데이터 로드 ──────────────────────────────────────
    print("\n[1/6] 데이터 로드...")
    draws   = sb_get("lotto_draws", "draw_no,n1,n2,n3,n4,n5,n6")
    total   = len(draws)
    first_no = draws[0]['draw_no']
    last_no  = draws[-1]['draw_no']
    print(f"  → {total}회차  ({first_no}회 ~ {last_no}회)")

    # ── 2. 시간 가중치 ──────────────────────────────────────
    print(f"\n[2/6] 시간 가중치 (λ={DECAY_LAMBDA}) ...")
    # draw_no가 클수록(최근) weight → 1,  오래될수록 → 0
    draw_nos = np.array([d['draw_no'] for d in draws], dtype=float)
    weights  = DECAY_LAMBDA ** (last_no - draw_nos)
    total_w  = float(weights.sum())
    print(f"  가중합 = {total_w:.2f}  (단순합 대비 {total_w/total*100:.1f}%)")

    # 번호별 집계 (index 1~45)
    raw_cnt = np.zeros(46, dtype=float)
    w_cnt   = np.zeros(46, dtype=float)
    pair_raw: dict = {}
    pair_w:   dict = {}

    for i, d in enumerate(draws):
        nums = [d['n1'], d['n2'], d['n3'], d['n4'], d['n5'], d['n6']]
        ww = float(weights[i])
        for n in nums:
            raw_cnt[n] += 1
            w_cnt[n]   += ww
        for ai in range(6):
            for bi in range(ai + 1, 6):
                key = (min(nums[ai], nums[bi]), max(nums[ai], nums[bi]))
                pair_raw[key] = pair_raw.get(key, 0) + 1
                pair_w[key]   = pair_w.get(key, 0.0) + ww

    # ── 3. Dirichlet-Multinomial 베이지안 ───────────────────
    print("\n[3/6] Dirichlet-Multinomial 사후확률 계산...")
    # 사전: Dir(α₀)  α₀=1 (균등/무정보적)
    # 사후: Dir(α)   αᵢ = α₀ + Σ weighted_count_i
    alphas    = ALPHA_PRIOR + w_cnt[1:46]          # shape (45,)
    alpha_sum = float(alphas.sum())

    post_mean = alphas / alpha_sum                 # 사후 기대값
    post_var  = alphas * (alpha_sum - alphas) / (alpha_sum**2 * (alpha_sum + 1))
    post_std  = np.sqrt(post_var)

    theo = 6.0 / 45.0                             # 이론적 등장 확률
    zscores = (post_mean - theo) / post_std        # 표준화 편차

    # 95% 신뢰구간: Beta(αᵢ, Σⱼ≠ᵢ αⱼ) 근사
    print("  신뢰구간 계산 중 (45개 Beta PPF)...")
    cred_lo = np.zeros(45)
    cred_hi = np.zeros(45)
    for i in range(45):
        a_i = float(alphas[i])
        b_i = alpha_sum - a_i
        cred_lo[i] = beta_ppf(0.025, a_i, b_i)
        cred_hi[i] = beta_ppf(0.975, a_i, b_i)

    is_hot  = cred_lo > theo   # 95% CI 전체가 이론값 위 → 통계적으로 유의미한 핫
    is_cold = cred_hi < theo   # 95% CI 전체가 이론값 아래 → 통계적 콜드
    rank_of = np.empty(45, dtype=int)
    for r, idx in enumerate(np.argsort(-post_mean)):
        rank_of[idx] = r + 1

    # ── 4. 카이제곱 균등분포 검정 ───────────────────────────
    print("\n[4/6] χ² 균등분포 검정 (H₀: 모든 번호 등확률)...")
    observed      = raw_cnt[1:46]
    expected_each = total * 6.0 / 45.0
    chi2_stat     = float(np.sum((observed - expected_each) ** 2 / expected_each))
    chi2_p        = chi2_pvalue(chi2_stat, df=44)   # df = 45-1
    is_uniform    = chi2_p > 0.05
    print(f"  χ² = {chi2_stat:.3f}   p = {chi2_p:.4f}")
    print(f"  → {'균등분포 기각 불가 (공정성 유지)' if is_uniform else '⚠️ 균등분포 기각 — 번호 편향 감지!'}")

    # ── 5. Supabase 저장 ────────────────────────────────────
    print("\n[5/6] Supabase 저장...")

    # 5-A. 메타
    meta_res = sb_post("lotto_analysis_meta", {
        "total_draws":      total,
        "first_draw":       first_no,
        "last_draw":        last_no,
        "decay_lambda":     DECAY_LAMBDA,
        "chi_square_stat":  chi2_stat,
        "chi_square_pvalue":chi2_p,
        "is_uniform":       bool(is_uniform),
        "model_version":    "1.0"
    })
    meta_id = meta_res[0]['id']
    print(f"  메타 저장 완료  (id={meta_id})")

    # 5-B. 번호별 통계 (45행)
    num_rows = [{
        "meta_id":         meta_id,
        "number":          i + 1,
        "raw_count":       int(raw_cnt[i + 1]),
        "weighted_count":  float(w_cnt[i + 1]),
        "total_draws":     total,
        "posterior_alpha": float(alphas[i]),
        "posterior_mean":  float(post_mean[i]),
        "posterior_std":   float(post_std[i]),
        "credible_lower":  float(cred_lo[i]),
        "credible_upper":  float(cred_hi[i]),
        "theoretical_prob":theo,
        "zscore":          float(zscores[i]),
        "is_hot":          bool(is_hot[i]),
        "is_cold":         bool(is_cold[i]),
        "bayesian_rank":   int(rank_of[i])
    } for i in range(45)]
    sb_post("lotto_number_stats", num_rows)
    print(f"  번호별 통계 45개 저장 완료")

    # 5-C. 번호쌍 Top 300
    print(f"  번호쌍 계산 중 ({len(pair_raw)}쌍 → Top {TOP_PAIRS})...")
    pair_theo = (6 * 5) / (45 * 44)   # P(특정 두 번호 모두 당첨) ≈ 1.52%
    pair_list = []
    for (na, nb), cnt in pair_raw.items():
        wc  = float(pair_w[(na, nb)])
        ba  = 1.0 + wc
        bb  = 1.0 + (total_w - wc)
        pmean = ba / (ba + bb)
        pair_list.append({
            "meta_id":           meta_id,
            "num_a":             na,
            "num_b":             nb,
            "co_count":          int(cnt),
            "weighted_co_count": wc,
            "total_draws":       total,
            "beta_alpha":        ba,
            "beta_beta":         bb,
            "posterior_mean":    pmean,
            "credible_lower":    beta_ppf(0.025, ba, bb),
            "credible_upper":    beta_ppf(0.975, ba, bb),
            "theoretical_prob":  pair_theo
        })
    pair_list.sort(key=lambda x: -x['posterior_mean'])
    sb_post("lotto_pair_stats", pair_list[:TOP_PAIRS])
    print(f"  번호쌍 Top {TOP_PAIRS}개 저장 완료")

    # ── 6. 결과 요약 출력 ────────────────────────────────────
    print("\n[6/6] 분석 결과 ════════════════════════════════")
    print(f"\n  📊 분석 회차: {total}회  (가중합 {total_w:.1f})")

    hot_nums  = [i + 1 for i in range(45) if is_hot[i]]
    cold_nums = [i + 1 for i in range(45) if is_cold[i]]

    print(f"\n  🔥 통계적 핫번호 (95% 사후신뢰구간 > 이론값):")
    print(f"     {hot_nums if hot_nums else '없음 — 유의미한 편향 없음'}")
    print(f"\n  ❄️  통계적 콜드번호 (95% 사후신뢰구간 < 이론값):")
    print(f"     {cold_nums if cold_nums else '없음'}")

    print(f"\n  🏆 베이지안 사후확률 Top 10:")
    for idx in np.argsort(-post_mean)[:10]:
        n = idx + 1
        flag = "🔥" if is_hot[idx] else ("❄️" if is_cold[idx] else "  ")
        print(f"     {flag} {n:2d}번  {post_mean[idx]*100:.4f}%"
              f"  [{cred_lo[idx]*100:.4f}%, {cred_hi[idx]*100:.4f}%]"
              f"  z={zscores[idx]:+.2f}  출현{int(raw_cnt[n])}회")

    print(f"\n  🔗 동반 출현 Top 10 쌍:")
    for p in pair_list[:10]:
        flag = "↑" if p['posterior_mean'] > pair_theo else "↓"
        print(f"     ({p['num_a']:2d},{p['num_b']:2d})  "
              f"{p['co_count']}회  "
              f"사후P={p['posterior_mean']*100:.3f}%  "
              f"이론P={pair_theo*100:.3f}%  {flag}")

    print(f"\n  📐 카이제곱 검정:")
    print(f"     χ²={chi2_stat:.3f}  df=44  p={chi2_p:.4f}")
    if is_uniform:
        print("     → H₀ 기각 불가: 로또 번호 분포는 통계적으로 공정")
    else:
        print("     → ⚠️ H₀ 기각: 일부 번호에 통계적 편향 존재!")

    print(f"\n✅ 베이지안 분석 완료  (meta_id={meta_id})")
    print("=" * 55)
    return meta_id

if __name__ == "__main__":
    run()
