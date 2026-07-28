#!/usr/bin/env python3
"""
로또 베이지안 재분석 v1.1 — 오프라인 (파일 I/O 전용)
────────────────────────────────────────────────────
입력: /tmp/lotto_draws.json  (JSON 배열: [{draw_no, n1..n6}, ...])
출력: /tmp/lotto_bayes_result.json

네트워크 없이 순수 수치 계산만 수행.
Supabase I/O는 외부(스케줄 SKILL.md)에서 MCP로 처리.
────────────────────────────────────────────────────
"""

import math
import json
import numpy as np
from datetime import datetime, timezone

# ══ 설정 ═══════════════════════════════════════════════════════
DECAY_LAMBDA = 0.998    # 시간 감쇠 계수
TOP_PAIRS    = 300      # 저장할 상위 번호쌍 수
ALPHA_PRIOR  = 1.0      # Dirichlet 사전분포 (균등/무정보적)
THEO_DIR     = 1.0 / 45.0   # Dirichlet-Multinomial 이론값 (단일 공 위치 = 번호 i)
MODEL_VER    = "1.1"

INPUT_FILE  = "/tmp/lotto_draws.json"
OUTPUT_FILE = "/tmp/lotto_bayes_result.json"

# ══ 수학 유틸리티 (scipy 불필요) ════════════════════════════════

def _reg_lower_gamma(a: float, x: float, max_iter: int = 300) -> float:
    """정규화 하위 불완전 감마함수 P(a, x)"""
    if x <= 0:
        return 0.0
    lga = math.lgamma(a)
    if x < a + 1:
        ap = a; val = s = 1.0 / a
        for _ in range(max_iter):
            ap += 1; val *= x / ap; s += val
            if abs(val) < abs(s) * 1e-12:
                break
        return min(1.0, s * math.exp(-x + a * math.log(x) - lga))
    else:
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
    return 1.0 - _reg_lower_gamma(df / 2.0, stat / 2.0)

def _beta_cf(x: float, a: float, b: float, max_iter: int = 200) -> float:
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
    lo, hi = 0.0, 1.0
    for _ in range(120):
        mid = (lo + hi) / 2
        if beta_cdf(mid, a, b) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break
    return (lo + hi) / 2

# ══ 메인 ════════════════════════════════════════════════════════

def run():
    print("=" * 55)
    print("  로또 베이지안 재분석 v1.1  (오프라인)")
    print(f"  실행: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 55)

    # ── 1. 데이터 로드 ─────────────────────────────────────────
    print(f"\n[1/5] {INPUT_FILE} 로드...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        draws = json.load(f)
    total    = len(draws)
    first_no = draws[0]["draw_no"]
    last_no  = draws[-1]["draw_no"]
    print(f"  → {total}회차  ({first_no}회 ~ {last_no}회)")

    # ── 2. 시간 가중치 ─────────────────────────────────────────
    print(f"\n[2/5] 시간 가중치 (λ={DECAY_LAMBDA})...")
    draw_nos = np.array([d["draw_no"] for d in draws], dtype=float)
    weights  = DECAY_LAMBDA ** (last_no - draw_nos)
    total_w  = float(weights.sum())
    print(f"  가중합 = {total_w:.2f}  (단순합 대비 {total_w/total*100:.1f}%)")

    # ── 3. 번호별 집계 ─────────────────────────────────────────
    raw_cnt = np.zeros(46, dtype=float)
    w_cnt   = np.zeros(46, dtype=float)
    pair_raw: dict = {}
    pair_w:   dict = {}

    for i, d in enumerate(draws):
        nums = [d["n1"], d["n2"], d["n3"], d["n4"], d["n5"], d["n6"]]
        ww = float(weights[i])
        for n in nums:
            raw_cnt[n] += 1
            w_cnt[n]   += ww
        for ai in range(6):
            for bi in range(ai + 1, 6):
                key = (min(nums[ai], nums[bi]), max(nums[ai], nums[bi]))
                pair_raw[key] = pair_raw.get(key, 0) + 1
                pair_w[key]   = pair_w.get(key, 0.0) + ww

    # ── 4. Dirichlet-Multinomial 사후확률 ──────────────────────
    print("\n[3/5] Dirichlet-Multinomial 사후확률 계산...")
    alphas    = ALPHA_PRIOR + w_cnt[1:46]       # shape (45,)
    alpha_sum = float(alphas.sum())
    post_mean = alphas / alpha_sum
    post_var  = alphas * (alpha_sum - alphas) / (alpha_sum**2 * (alpha_sum + 1))
    post_std  = np.sqrt(post_var)
    # ★ 올바른 이론값: 1/45 (Dirichlet 맥락에서 단일 위치 확률)
    zscores   = (post_mean - THEO_DIR) / post_std

    print("  신뢰구간 계산 중 (Beta PPF, 45개)...")
    cred_lo = np.zeros(45)
    cred_hi = np.zeros(45)
    for i in range(45):
        a_i = float(alphas[i])
        b_i = alpha_sum - a_i
        cred_lo[i] = beta_ppf(0.025, a_i, b_i)
        cred_hi[i] = beta_ppf(0.975, a_i, b_i)

    is_hot  = cred_lo > THEO_DIR
    is_cold = cred_hi < THEO_DIR
    rank_of = np.empty(45, dtype=int)
    for r, idx in enumerate(np.argsort(-post_mean)):
        rank_of[idx] = r + 1

    # ── 5. 카이제곱 검정 ───────────────────────────────────────
    observed      = raw_cnt[1:46]
    expected_each = total * 6.0 / 45.0
    chi2_stat     = float(np.sum((observed - expected_each) ** 2 / expected_each))
    chi2_p        = chi2_pvalue(chi2_stat, df=44)
    is_uniform    = chi2_p > 0.05
    print(f"  χ² = {chi2_stat:.3f}   p = {chi2_p:.4f}")
    print(f"  → {'균등분포 기각 불가 (공정)' if is_uniform else '⚠️ 편향 감지!'}")

    # ── 5. Beta-Binomial 번호쌍 ────────────────────────────────
    print(f"\n[4/5] Beta-Binomial 번호쌍 분석 (→ Top {TOP_PAIRS})...")
    pair_theo = (6 * 5) / (45 * 44)
    pair_list = []
    for (na, nb), cnt in pair_raw.items():
        wc  = float(pair_w[(na, nb)])
        ba  = 1.0 + wc
        bb  = 1.0 + (total_w - wc)
        pmean = ba / (ba + bb)
        pair_list.append({
            "num_a":             na,
            "num_b":             nb,
            "co_count":          int(cnt),
            "weighted_co_count": round(wc, 4),
            "total_draws":       total,
            "beta_alpha":        round(ba, 4),
            "beta_beta":         round(bb, 4),
            "posterior_mean":    round(pmean, 8),
            "credible_lower":    round(beta_ppf(0.025, ba, bb), 8),
            "credible_upper":    round(beta_ppf(0.975, ba, bb), 8),
            "theoretical_prob":  round(pair_theo, 8)
        })
    pair_list.sort(key=lambda x: -x["posterior_mean"])
    pair_list = pair_list[:TOP_PAIRS]
    print(f"  완료: {len(pair_list)}쌍")

    # ── 6. 결과 조립 ───────────────────────────────────────────
    print("\n[5/5] JSON 결과 저장...")
    analyzed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    meta = {
        "analyzed_at":        analyzed_at,
        "total_draws":        total,
        "first_draw":         first_no,
        "last_draw":          last_no,
        "decay_lambda":       DECAY_LAMBDA,
        "chi_square_stat":    round(chi2_stat, 4),
        "chi_square_pvalue":  round(chi2_p, 4),
        "is_uniform":         bool(is_uniform),
        "model_version":      MODEL_VER
    }

    numbers = [{
        "number":          i + 1,
        "raw_count":       int(raw_cnt[i + 1]),
        "weighted_count":  round(float(w_cnt[i + 1]), 4),
        "total_draws":     total,
        "posterior_alpha": round(float(alphas[i]), 4),
        "posterior_mean":  round(float(post_mean[i]), 8),
        "posterior_std":   round(float(post_std[i]), 8),
        "credible_lower":  round(float(cred_lo[i]), 8),
        "credible_upper":  round(float(cred_hi[i]), 8),
        "theoretical_prob": round(THEO_DIR, 8),
        "zscore":          round(float(zscores[i]), 4),
        "is_hot":          bool(is_hot[i]),
        "is_cold":         bool(is_cold[i]),
        "bayesian_rank":   int(rank_of[i])
    } for i in range(45)]

    result = {"meta": meta, "numbers": numbers, "pairs": pair_list}
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"  저장 완료: {OUTPUT_FILE}")

    # ── 요약 출력 ──────────────────────────────────────────────
    print(f"\n{'='*55}")
    print(f"  📊 분석 회차: {total}회  ({first_no}~{last_no}회)")
    print(f"  χ²={chi2_stat:.3f}  p={chi2_p:.4f}  {'공정 ✓' if is_uniform else '편향 ⚠️'}")
    top3 = sorted(range(45), key=lambda i: -post_mean[i])[:3]
    print(f"  🏆 Top3: {[i+1 for i in top3]}  (p={[round(post_mean[i]*100,3) for i in top3]}%)")
    pair_top = pair_list[0]
    print(f"  🔗 최강페어: ({pair_top['num_a']},{pair_top['num_b']})  {pair_top['co_count']}회")
    print(f"{'='*55}")
    print(f"\n✅ 분석 완료 → {OUTPUT_FILE}")

if __name__ == "__main__":
    run()
