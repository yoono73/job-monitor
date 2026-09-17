#!/usr/bin/env python3
"""
나라일터 e10 공고유형 진단 스크립트
목적: type01=e10 공고가 교육청 계열인지 확인 (제외 타당성 검증)

실행 방법:
  로컬: DATAGOKR_API_KEY=<key> python check_e10.py
  Actions: workflow_dispatch job에 step으로 추가
"""
import os, sys, requests, xml.etree.ElementTree as ET
from collections import Counter
from urllib.parse import quote, unquote
from datetime import date, timedelta

API_KEY = (
    os.environ.get("DATAGOKR_API_KEY") or
    os.environ.get("NARAIJARI_API_KEY") or ""
)
if not API_KEY:
    print("ERROR: DATAGOKR_API_KEY 또는 NARAIJARI_API_KEY 환경변수 필요", file=sys.stderr)
    sys.exit(1)

enc_key  = quote(unquote(API_KEY), safe="")
NARA_URL = "https://apis.data.go.kr/1760000/PblJobService/getList"
HEADERS  = {"Accept": "application/xml", "User-Agent": "Mozilla/5.0 job-monitor-diag"}

today    = date.today()
begin_de = (today - timedelta(days=1)).strftime("%Y%m%d")
end_de   = (today + timedelta(days=90)).strftime("%Y%m%d")

# 광범위 키워드로 수집 후 type01=e10 필터링
# (type01은 응답 필드 — 요청 파라미터 필터 불가)
search_keywords = ["", "채용", "모집", "직원"]

all_jobs: list[dict] = []
seen_idx: set[str]   = set()

print(f"나라일터 e10 진단 — {today}")
print("=" * 70)

for kwrd in search_keywords:
    kw_param = f"&Kwrd={quote(kwrd, safe='')}" if kwrd else ""
    url = (
        f"{NARA_URL}?serviceKey={enc_key}"
        f"&pageNo=1&numOfRows=500"
        f"{kw_param}"
        f"&Begin_de={begin_de}&End_de={end_de}"
        f"&Sort_order=ASC&type=xml"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)

        result_code = root.findtext(".//resultCode") or ""
        items = root.findall(".//item")
        new_cnt = 0
        for item in items:
            _g = lambda tag, i=item: (i.findtext(tag) or "").strip()
            idx = _g("idx")
            if not idx or idx in seen_idx:
                continue
            seen_idx.add(idx)
            new_cnt += 1
            all_jobs.append({
                "idx":    idx,
                "type01": _g("type01"),
                "type02": _g("type02"),
                "org":    _g("insttname"),
                "title":  _g("title"),
                "end":    _g("enddate"),
                "area":   _g("areacode"),
            })
        print(f"  kwrd='{kwrd}': {len(items)}건 수신 / 신규 {new_cnt}건 추가 (rc={result_code or 'OK'})")
    except Exception as e:
        print(f"  오류(kwrd='{kwrd}'): {e}")

# e10만 필터링
e10 = [j for j in all_jobs if j["type01"] == "e10"]

print(f"\n전체 수집: {len(all_jobs)}건 / e10: {len(e10)}건")
print("=" * 70)
print(f"{'기관명':<32} {'제목':<45} 마감")
print("-" * 70)
for j in e10[:20]:
    print(f"{j['org'][:31]:<32} {j['title'][:44]:<45} {j['end']}")
if len(e10) > 20:
    print(f"  ... 이하 {len(e10)-20}건 생략")

# type01 전체 분포 (판단 근거)
print("\n공고유형(type01) 전체 분포:")
dist = Counter(j["type01"] for j in all_jobs)
for t, cnt in sorted(dist.items()):
    label = {
        "e01": "공개경쟁채용",
        "e02": "경력경쟁채용",
        "e03": "계약직",
        "e04": "행정지원",
        "e06": "공모직위",
        "e08": "전문업무직",
        "e10": "???",
    }.get(t, t)
    print(f"  {t} ({label}): {cnt}건")

print("=" * 70)
print("→ e10 기관명에 '교육청'·'학교'·'학원' 등 교육 계열이 주류이면 제외 타당")
print("→ 일반 공공기관이 섞여 있으면 별도 판단 필요")
