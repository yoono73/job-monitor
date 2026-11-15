#!/usr/bin/env python3
"""
로또 누적분석 증분 업데이트 스크립트
사용법: python scripts/update_analysis.py
- 기존 lotto_analysis_cache.json을 로드
- last_draw 이후 신규 회차만 Supabase에서 가져와 누적 반영
- 처음 실행 시 전체 분석 (1회~최신회)
"""
import json, os, re, collections, statistics, urllib.request, urllib.parse

CACHE_PATH = os.path.join(os.path.dirname(__file__), '..', 'lotto_analysis_cache.json')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY', '')


def fetch_draws(from_draw=1):
    """Supabase REST API로 회차 데이터 조회"""
    url = f"{SUPABASE_URL}/rest/v1/lotto_draws?draw_no=gte.{from_draw}&order=draw_no.asc&select=draw_no,n1,n2,n3,n4,n5,n6,bonus"
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def calc_ac(nums):
    s = sorted(nums)
    diffs = set()
    for i in range(len(s)):
        for j in range(i+1, len(s)):
            diffs.add(s[j]-s[i])
    return len(diffs)-5


def analyze_draws(rows):
    """회차 목록으로 전체 통계 계산"""
    draws = [{'no': r['draw_no'], 'nums': sorted([r['n1'],r['n2'],r['n3'],r['n4'],r['n5'],r['n6']]), 'bonus': r['bonus']} for r in rows]

    freq = collections.Counter()
    pair_c = collections.Counter()
    sums = []
    odd_c = collections.Counter()
    low_c = collections.Counter()
    cons_c = collections.Counter()
    ac_c = collections.Counter()
    tail_f = collections.Counter()
    zone3_c = collections.Counter()

    for d in draws:
        nums = d['nums']
        for n in nums:
            freq[n] += 1
            tail_f[n % 10] += 1
        for i in range(6):
            for j in range(i+1, 6):
                pair_c[(nums[i], nums[j])] += 1
        s = sum(nums)
        sums.append(s)
        odd_c[sum(1 for n in nums if n%2==1)] += 1
        low_c[sum(1 for n in nums if n<=22)] += 1
        cs = sorted(nums)
        cons_c[sum(1 for i in range(5) if cs[i+1]-cs[i]==1)] += 1
        ac_c[calc_ac(nums)] += 1
        lo = sum(1 for n in nums if n<=15)
        mi = sum(1 for n in nums if 16<=n<=30)
        hi = sum(1 for n in nums if n>=31)
        zone3_c[(lo,mi,hi)] += 1

    return {
        "version": 2,
        "last_draw": draws[-1]['no'],
        "total_draws": len(draws),
        "freq": {str(k): v for k, v in freq.items()},
        "pair_top50": [(list(p), c) for p, c in pair_c.most_common(50)],
        "sum_avg": statistics.mean(sums),
        "sum_std": statistics.stdev(sums),
        "sum_median": statistics.median(sums),
        "odd_dist": {str(k): v for k, v in odd_c.items()},
        "low_dist": {str(k): v for k, v in low_c.items()},
        "cons_dist": {str(k): v for k, v in cons_c.items()},
        "ac_dist": {str(k): v for k, v in ac_c.items()},
        "tail_freq": {str(k): v for k, v in tail_f.items()},
        "zone3_top20": [(list(p), c) for p, c in zone3_c.most_common(20)],
    }


def merge_cache(old_cache, new_rows):
    """기존 캐시에 신규 회차만 증분 반영"""
    if not new_rows:
        print("신규 회차 없음 — 캐시 최신 상태")
        return old_cache

    print(f"신규 {len(new_rows)}회차 증분 반영 ({new_rows[0]['draw_no']}~{new_rows[-1]['draw_no']}회)")

    freq = collections.Counter({int(k): v for k, v in old_cache['freq'].items()})
    tail_f = collections.Counter({int(k): v for k, v in old_cache['tail_freq'].items()})
    odd_c = collections.Counter({int(k): v for k, v in old_cache['odd_dist'].items()})
    low_c = collections.Counter({int(k): v for k, v in old_cache['low_dist'].items()})
    cons_c = collections.Counter({int(k): v for k, v in old_cache['cons_dist'].items()})
    ac_c = collections.Counter({int(k): v for k, v in old_cache['ac_dist'].items()})
    zone3_c = collections.Counter({tuple(p): c for p, c in old_cache['zone3_top20']})
    old_sums_avg = old_cache['sum_avg']
    old_sums_std = old_cache['sum_std']
    old_total = old_cache['total_draws']

    new_sums = []
    for r in new_rows:
        nums = sorted([r['n1'],r['n2'],r['n3'],r['n4'],r['n5'],r['n6']])
        for n in nums:
            freq[n] += 1
            tail_f[n % 10] += 1
        odd_c[sum(1 for n in nums if n%2==1)] += 1
        low_c[sum(1 for n in nums if n<=22)] += 1
        cs = nums
        cons_c[sum(1 for i in range(5) if cs[i+1]-cs[i]==1)] += 1
        ac_c[calc_ac(nums)] += 1
        lo = sum(1 for n in nums if n<=15)
        mi = sum(1 for n in nums if 16<=n<=30)
        hi = sum(1 for n in nums if n>=31)
        zone3_c[(lo,mi,hi)] += 1
        new_sums.append(sum(nums))

    new_total = old_total + len(new_rows)
    # 평균 업데이트 (Welford 방식 근사)
    all_sum_total = old_sums_avg * old_total + sum(new_sums)
    new_avg = all_sum_total / new_total

    old_cache['last_draw'] = new_rows[-1]['draw_no']
    old_cache['total_draws'] = new_total
    old_cache['freq'] = {str(k): v for k, v in freq.items()}
    old_cache['tail_freq'] = {str(k): v for k, v in tail_f.items()}
    old_cache['odd_dist'] = {str(k): v for k, v in odd_c.items()}
    old_cache['low_dist'] = {str(k): v for k, v in low_c.items()}
    old_cache['cons_dist'] = {str(k): v for k, v in cons_c.items()}
    old_cache['ac_dist'] = {str(k): v for k, v in ac_c.items()}
    old_cache['zone3_top20'] = [(list(p), c) for p, c in zone3_c.most_common(20)]
    old_cache['sum_avg'] = new_avg
    old_cache['version'] = 2

    return old_cache


def main():
    # 기존 캐시 로드
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            cache = json.load(f)
        from_draw = cache['last_draw'] + 1
        print(f"기존 캐시 로드: {cache['total_draws']}회차 (마지막 {cache['last_draw']}회)")
    else:
        cache = None
        from_draw = 1
        print("캐시 없음 — 전체 분석 시작")

    # 신규 데이터 조회
    rows = fetch_draws(from_draw)
    print(f"Supabase에서 {from_draw}회 이후 {len(rows)}회차 조회")

    if cache is None:
        # 최초 전체 분석
        result = analyze_draws(rows)
    else:
        # 증분 업데이트
        result = merge_cache(cache, rows)

    with open(CACHE_PATH, 'w') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"✅ 저장 완료: {CACHE_PATH} ({result['total_draws']}회차, 마지막={result['last_draw']}회)")


if __name__ == '__main__':
    main()
