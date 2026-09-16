#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
채용공고 자동 모니터링 v2 — job_monitor.py
수집원: ① 한국지역정보개발원 (지방공기업·출자출연)
        ② 재정경제부 (중앙 공공기관 113,852건)
        ③ 인사혁신처 나라일터 (보조)
        ④ 철도산업정보센터 / ⑤ 한국철도공사 (보조 크롤러)
설정: keywords.json, sido_codes.json (코드 수정 없이 튜닝 가능)
실행: GitHub Actions 매일 KST 07:00 / 로컬: python job_monitor.py
"""

import hashlib
import json
import logging
import os
import re
import smtplib
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from urllib.parse import quote as _quote, unquote as _unquote

import requests
from bs4 import BeautifulSoup

# ── 경고 로그 파일 ──────────────────────────────────────────────────────────
_BASE = Path(__file__).parent
_LOG_DIR = _BASE / "logs"
_LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    filename=str(_LOG_DIR / "warn.log"),
    level=logging.WARNING,
    format="%(asctime)s %(levelname)s %(message)s",
    encoding="utf-8",
)

# ── .env 자동 로드 (로컬 실행 시) ───────────────────────────────────────────
_env_file = _BASE / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

# ── 환경변수 ────────────────────────────────────────────────────────────────
_EMAIL_TO_RAW       = os.environ.get("EMAIL_TO", "yoono73@gmail.com")
_EMAIL_TO_ADMIN_RAW = os.environ.get("EMAIL_TO_ADMIN", "")

EMAIL_TO_LIST       = [e.strip() for e in _EMAIL_TO_RAW.split(",") if e.strip()]
EMAIL_TO_ADMIN_LIST = [e.strip() for e in _EMAIL_TO_ADMIN_RAW.split(",") if e.strip()]
EMAIL_TO            = ", ".join(EMAIL_TO_LIST)
EMAIL_TO_ADMIN      = ", ".join(EMAIL_TO_ADMIN_LIST)

GMAIL_USER     = os.environ.get("GMAIL_USER", "")
GMAIL_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

# 인사혁신처 나라일터 키 (data.go.kr 동일 계정 — KRID·MOEF 공용 가능)
NARAIJARI_API_KEY = os.environ.get("NARAIJARI_API_KEY", "").strip()

# data.go.kr 공용 API 키 (지역정보개발원·재정경제부)
# 우선순위: DATAGOKR_API_KEY → NARAIJARI_API_KEY (같은 계정) → ALIO_API_KEY (구키, 폴백)
DATAGOKR_API_KEY  = (
    os.environ.get("DATAGOKR_API_KEY") or
    NARAIJARI_API_KEY or
    os.environ.get("ALIO_API_KEY", "")
).strip()

SEEN_IDS_FILE   = _BASE / "seen_ids.json"
RUN_STATS_FILE  = _BASE / "run_stats.json"  # 실행별 KRID 성공/실패 기록
_RUN_STATS_KEEP = 90  # 보관 일수

URGENT_DAYS = 7

# ── 설정 파일 로드 ───────────────────────────────────────────────────────────
def _load_json(filename: str, default):
    path = _BASE / filename
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            logging.warning("%s 로드 실패: %s", filename, e)
    return default

KW = _load_json("keywords.json", {
    "track_a": {"ncs_auto": ["R600020"], "ncs_keyword": ["R600001", "R600002"],
                "field": ["정보통신"], "include": ["전산", "정보통신", "보안", "IT"],
                "exclude": []},
    "track_b": {"ncs": ["R600002", "R600001"], "field": ["사무", "행정"],
                "include": ["행정", "예산", "회계", "계약"], "exclude": []},
    "common": {"region": ["서울", "경기", "인천"], "employ_include": ["정규직", "무기계약직"],
               "title_exclude": ["청년인턴", "인턴"]},
    "naraijari_kwrd": ["전산", "정보통신", "보안", "IT"],
})

SIDO_CODES = _load_json("sido_codes.json", {
    "서울특별시": "007001", "인천광역시": "007004", "경기도": "007008",
})

# ── HTTP 헤더 ───────────────────────────────────────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
}

# ══════════════════════════════════════════════════════════════════════════════
# 유틸리티
# ══════════════════════════════════════════════════════════════════════════════

def load_seen() -> set:
    if SEEN_IDS_FILE.exists():
        try:
            data = json.loads(SEEN_IDS_FILE.read_text(encoding="utf-8"))
            return set(data) if isinstance(data, list) else set()
        except json.JSONDecodeError:
            return set()
    return set()


def save_seen(seen: set):
    SEEN_IDS_FILE.write_text(
        json.dumps(sorted(seen), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def days_left(deadline_str: str) -> int | None:
    if not deadline_str:
        return None
    for fmt in ("%Y.%m.%d", "%Y-%m-%d", "%Y%m%d"):
        try:
            d = datetime.strptime(str(deadline_str).strip()[:10], fmt).date()
            return (d - date.today()).days
        except ValueError:
            continue
    return None


def grade(matched_count: int) -> str:
    if matched_count >= 3:
        return "상"
    if matched_count >= 1:
        return "중"
    return "하"


def _job_hash(job: dict) -> str:
    """기관명+제목 조합 해시 — 서로 다른 API가 같은 공고를 제공하는 경우 중복 제거"""
    key = (job.get("org", "") + "|" + job.get("title", "")).strip()
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:12]


# ══════════════════════════════════════════════════════════════════════════════
# 수집 ①  한국지역정보개발원 API — 지방공기업·출자출연기관
# ══════════════════════════════════════════════════════════════════════════════

_KRID_URL = (
    "https://apis.data.go.kr/B551982/openApiEmployInfo/openXmlEmployInfo"
)

_KRID_NG_JOB_TYPES = {"비상임", "계약직", "기간제", "임시직", "촉탁", "파견", "한시임기제", "시간제"}

def fetch_krid(api_key: str, sido_cd: str, sido_nm: str) -> tuple[list[dict], list[str], bool]:
    """
    한국지역정보개발원 지방공기업 채용 API 호출
    Returns: (jobs, actual_field_names, success_flag)
    success_flag=False: 타임아웃·파싱오류 등 수집 자체 실패
    """
    if not api_key:
        print(f"  지역정보개발원({sido_nm}): API 키 없음")
        return [], [], False

    enc_key = _quote(_unquote(api_key), safe="")   # + → %2B, = → %3D (나라일터와 동일 방식)
    url = f"{_KRID_URL}?serviceKey={enc_key}&sidoCd={sido_cd}&type=xml"
    print(f"  [DEBUG KRID] url[:120]={url[:120]}")

    resp = None
    _retry_delays = [10, 30]  # 1차 실패→10초, 2차 실패→30초 대기
    for attempt in range(len(_retry_delays) + 1):  # 총 3회 시도
        try:
            resp = requests.get(url, headers=HEADERS, timeout=(30, 180))
            break
        except requests.exceptions.Timeout:
            if attempt < len(_retry_delays):
                wait = _retry_delays[attempt]
                print(f"  지역정보개발원({sido_nm}): 타임아웃, {wait}초 후 재시도 ({attempt+1}/{len(_retry_delays)+1})...")
                time.sleep(wait)
            else:
                print(f"  지역정보개발원({sido_nm}): {len(_retry_delays)+1}회 시도 후 타임아웃 — 건너뜀")
                return [], [], False
        except Exception as e:
            logging.warning("KRID(%s) 연결 오류: %s", sido_nm, e)
            print(f"  지역정보개발원({sido_nm}): 연결 오류 — {e}")
            return [], [], False

    try:
        if resp.status_code != 200:
            print(f"  [DEBUG KRID] status={resp.status_code} body={resp.text[:300]}")
        resp.raise_for_status()
        root = ET.fromstring(resp.content)

        # 응답 코드 확인
        result_code = root.findtext(".//resultCode") or ""
        result_msg  = root.findtext(".//resultMsg") or ""
        if result_code and result_code not in ("0", "00", "0000", ""):
            logging.warning("KRID(%s) 오류코드: %s %s", sido_nm, result_code, result_msg)
            print(f"  지역정보개발원({sido_nm}): 오류코드 {result_code} {result_msg}")
            return [], [], False

        items = root.findall(".//item")
        if not items:
            print(f"  지역정보개발원({sido_nm}): 0건")
            return [], [], True  # 성공이지만 공고 없음

        # 첫 항목에서 실제 필드명 추출 (완료보고용)
        actual_fields = [child.tag for child in items[0]] if items else []

        jobs = []
        for item in items:
            _g = lambda tag, _item=item: (_item.findtext(tag) or "").strip()

            # 실제 XML 태그명 (대문자 언더스코어)
            no    = _g("NO")
            title = _g("ENT_TITLE")
            if not title:
                continue

            job_id = f"krid_{no}" if no else f"krid_{abs(hash(title + _g('ENT_NAME')))}"

            # STATUS: "모집중" 아닌 것 제외 (마감·공고종료 등)
            status = _g("STATUS")
            if status and "모집중" not in status:
                continue

            # JOB_TYPE 필드로 비정규직 1차 차단 (수집 단계)
            job_type = _g("JOB_TYPE")
            if job_type and any(ng in job_type for ng in _KRID_NG_JOB_TYPES):
                continue

            # URL: 빈값·"-"·"null" → None (폴백 목록페이지 금지)
            raw_url = _g("URL")
            url_val = None if (not raw_url or raw_url.strip().lower() in ("-", "null", "none")) else raw_url

            jobs.append({
                "id":               job_id,
                "source":           "지역정보개발원",
                "source_type":      f"지방공기업({sido_nm})",
                "title":            title,
                "org":              _g("ENT_NAME"),
                "inst_type":        _g("ENT_GB"),       # 지방공기업 | 출자출연기관
                "deadline":         _g("PUB_END_DATE"),
                "url":              url_val,
                "field":            job_type,
                "ncs_codes":        "",
                "employ_type":      "",        # EMPLOY_GB=신입/경력 구분이지 고용형태 아님 → 제목 필터로 대체
                "recruit_division": _g("ENT_RECRUIT"),
                "region":           sido_nm,  # sidoCd로 이미 지역 지정하여 호출 — API 반환값 무시
                "body":             _g("DUTY_DETAIL"),
                "certificate":      _g("ENT_LICENSE1"),
                "prefer":           _g("SPECIAL_ITEM"),
                "status":           status,
                "pay":              _g("YEARINCOME"),
            })

        print(f"  지역정보개발원({sido_nm}): {len(jobs)}건")
        return jobs, actual_fields, True

    except ET.ParseError as e:
        logging.warning("KRID(%s) XML 파싱 오류: %s", sido_nm, e)
        print(f"  지역정보개발원({sido_nm}): XML 파싱 오류 — {e}")
        return [], [], False
    except Exception as e:
        logging.warning("KRID(%s) 오류: %s", sido_nm, e)
        print(f"  지역정보개발원({sido_nm}): 오류 — {e}")
        return [], [], False


# ══════════════════════════════════════════════════════════════════════════════
# 수집 ②  재정경제부 API — 중앙 공공기관
# ══════════════════════════════════════════════════════════════════════════════

_MOEF_URL = "https://apis.data.go.kr/1051000/recruitment/list"

def fetch_moef(api_key: str, max_pages: int = 10) -> tuple[list[dict], dict]:
    """
    재정경제부 공공기관 채용 API (JSON)
    max_pages: 최대 페이지 수 (100건/페이지 → 1,000건 한도)
    Returns: (jobs, stats_dict)
    """
    if not api_key:
        print("  재정경제부: API 키 없음")
        return [], {}

    jobs: list[dict] = []
    seen_sns: set[str] = set()

    first_sns: list[str] = []   # 정렬방향 확인용
    total_api = 0
    page_no = 0  # NameError 방어 — 루프가 한 번도 실행되지 않는 경우 대비

    enc_key = _quote(_unquote(api_key), safe="")   # + → %2B, = → %3D (나라일터와 동일 방식)
    for page_no in range(1, max_pages + 1):
        url = (
            f"{_MOEF_URL}?serviceKey={enc_key}"
            f"&pageNo={page_no}&numOfRows=100&resultType=json"
        )
        if page_no == 1:
            print(f"  [DEBUG MOEF] url[:150]={url[:150]}")
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            if page_no == 1:
                print(f"  [DEBUG MOEF] status={resp.status_code} content-type={resp.headers.get('Content-Type','?')[:60]}")
                print(f"  [DEBUG MOEF] body[:200]={resp.text[:200]}")
            resp.raise_for_status()
            data = resp.json()

            # 공공데이터포털 중첩 구조: {"response": {"header": {...}, "body": {...}}}
            if "response" in data:
                header = data["response"].get("header", {})
                body   = data["response"].get("body", {})
                result_code = str(header.get("resultCode", ""))
                if page_no == 1:
                    print(f"  [DEBUG MOEF] 중첩구조 resultCode={result_code} totalCount={body.get('totalCount')}")
                if result_code not in ("00", "0", "200"):
                    logging.warning("MOEF 오류코드(중첩): %s", result_code)
                    break
                total_api = int(body.get("totalCount", 0))
                items = body.get("items") or {}
                if isinstance(items, dict):
                    result = items.get("item", [])
                elif isinstance(items, list):
                    result = items
                else:
                    result = []
                if isinstance(result, dict):
                    result = [result]
            else:
                # 플랫 구조: {"resultCode": "200", "result": [...]}
                result_code = str(data.get("resultCode", ""))
                if page_no == 1:
                    print(f"  [DEBUG MOEF] 플랫구조 resultCode={result_code} totalCount={data.get('totalCount')}")
                if result_code not in ("200", "00", "0"):
                    logging.warning("MOEF 오류코드: %s", result_code)
                    break
                result = data.get("result", [])
                if isinstance(result, dict):
                    result = [result]
                total_api = int(data.get("totalCount", 0))

            if not result:
                break

            for item in result:
                sn = str(item.get("recrutPblntSn") or "")
                if not sn or sn in seen_sns:
                    continue
                seen_sns.add(sn)

                # 정렬방향 확인용: 처음 5개 SN 기록
                if len(first_sns) < 5:
                    first_sns.append(sn)

                # 진행중 필터
                if item.get("ongoingYn", "Y") != "Y":
                    continue

                title = item.get("recrutPbancTtl") or ""
                if not title:
                    continue

                # srcUrl: 빈값 → None (폴백 금지 — 목록페이지 대체 시 404 발생 사례 있음)
                _src_url = (item.get("srcUrl") or "").strip()
                if not _src_url or _src_url.lower() in ("-", "null", "none"):
                    _src_url = None

                jobs.append({
                    "id":               f"moef_{sn}",
                    "source":           "재정경제부",
                    "source_type":      "중앙공공기관",
                    "title":            title,
                    "org":              item.get("instNm") or "",
                    "inst_type":        "",
                    "deadline":         item.get("pbancEndYmd") or "",
                    "url":              _src_url,  # srcUrl 그대로; 없으면 None
                    "field":            item.get("ncsCdNmLst") or "",
                    "ncs_codes":        item.get("ncsCdLst") or "",
                    "employ_type":      item.get("hireTypeNmLst") or "",
                    "recruit_division": item.get("recrutSeNm") or "",
                    "region":           item.get("workRgnNmLst") or "",
                    "body":             item.get("aplyQlfcCn") or "",
                    "certificate":      "",
                    "prefer":           "",
                    "status":           "Y" if item.get("ongoingYn") == "Y" else "",
                    "pay":              "",
                    "decimal_day":      str(item.get("decimalDay") or ""),
                })

        except requests.exceptions.HTTPError as e:
            logging.warning("MOEF HTTP 오류 page=%s: %s", page_no, e)
            print(f"  [DEBUG MOEF] HTTP 오류 page={page_no}: {e}", file=sys.stderr)
            break
        except Exception as e:
            logging.warning("MOEF 오류 page=%s: %s", page_no, e)
            print(f"  [DEBUG MOEF] 예외 page={page_no}: {type(e).__name__}: {e}", file=sys.stderr)
            break

    # 정렬방향 감지
    try:
        sns_int = [int(s) for s in first_sns if s.isdigit()]
        if len(sns_int) >= 2:
            sort_direction = "내림차순(최신순)" if sns_int[0] > sns_int[1] else "오름차순(오래된순)"
        else:
            sort_direction = "확인불가"
    except Exception:
        sort_direction = "확인불가"

    stats = {
        "collected": len(jobs),
        "total_api": total_api,
        "pages_fetched": min(page_no, max_pages),
        "traffic_used": f"{min(page_no, max_pages) * 100}/{min(total_api, 1000)}",
        "sort_direction": sort_direction,
        "first_sns": first_sns,
    }

    print(f"  재정경제부: {len(jobs)}건 (API 총계 {total_api}건, {sort_direction})")
    return jobs, stats


# ══════════════════════════════════════════════════════════════════════════════
# 수집 ③  인사혁신처 API (나라일터) — 키워드별 반복 호출
# ══════════════════════════════════════════════════════════════════════════════

_NARA_URL      = "https://apis.data.go.kr/1760000/PblJobService/getList"
_NARA_ITEM_URL = "https://apis.data.go.kr/1760000/PblJobService/getItem"
_NARA_LIST_PAGE = "https://www.gojobs.go.kr/apmList.do?menuNo=401&mngrMenuYn=N&selMenuNo=400"

def fetch_naraijari(api_key: str, kwrd_list: list[str]) -> tuple[list[dict], dict]:
    """
    인사혁신처 공공취업정보 API — 키워드별 반복 호출
    Returns: (jobs, stats_dict)
    """
    if not api_key:
        print("  나라일터: API 키 없음")
        return [], {}

    enc_key    = _quote(_unquote(api_key), safe="")   # unquote 먼저: 이중인코딩 방지
    today      = date.today()
    begin_de   = (today - timedelta(days=7)).strftime("%Y%m%d")  # API 요구: yyyymmdd
    end_de     = today.strftime("%Y%m%d")

    jobs: list[dict] = []
    seen_ids: set[str] = set()
    call_count = 0

    # Sort_order 감지: 1(오름차순) or 2(내림차순) 중 최신순 확인
    sort_order = "2"   # 기본값 내림차순 시도

    for kwrd in kwrd_list:
        url = (
            f"{_NARA_URL}?serviceKey={enc_key}"
            f"&pageNo=1&numOfRows=100"
            f"&Kwrd={_quote(kwrd, safe='')}"
            f"&Begin_de={begin_de}&End_de={end_de}"
            f"&Sort_order={sort_order}"
            f"&type=xml"
        )
        call_count += 1
        try:
            resp = requests.get(url, headers=HEADERS, timeout=8)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)

            result_code = root.findtext(".//resultCode") or ""
            if result_code and result_code not in ("00", "0000", ""):
                logging.warning("나라일터(%s) 오류: %s", kwrd, result_code)
                continue

            for item in root.findall(".//item"):
                _g = lambda tag, _item=item: (_item.findtext(tag) or "").strip()

                idx = _g("idx")
                if not idx:
                    continue
                job_id = f"naraijari_{idx}"
                if job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                # 마감일 기준 필터
                enddate_raw = _g("enddate")  # yyyymmdd
                if enddate_raw:
                    try:
                        enddate = datetime.strptime(enddate_raw[:8], "%Y%m%d").date()
                        if enddate < today:
                            continue
                    except ValueError:
                        pass

                # areacode 숫자코드 → 지역명 변환
                # 나라일터는 행정구역코드(5자리) 사용: 11=서울, 28=인천, 41=경기, 00000=전국
                areacode = _g("areacode")
                if areacode.startswith("11"):
                    region_nm = "서울"
                elif areacode.startswith("28"):
                    region_nm = "인천"
                elif areacode.startswith("41"):
                    region_nm = "경기"
                elif areacode == "00000" or not areacode:
                    region_nm = ""  # 전국/미지정 → 지역필터 통과
                else:
                    region_nm = areacode  # 지방: 필터에서 제외됨

                type01 = _g("type01")  # e01=공개경쟁, e02=경력경쟁, e06=공모직위 (통과)
                                       # e03=계약직, e04=행정지원, e08=전문업무직 (제외)
                jobs.append({
                    "id":               job_id,
                    "source":           "나라일터",
                    "source_type":      "나라일터",
                    "title":            _g("title"),
                    "org":              _g("insttname"),
                    "inst_type":        _g("type02"),
                    "deadline":         enddate_raw[:4]+"-"+enddate_raw[4:6]+"-"+enddate_raw[6:8]
                                        if len(enddate_raw) >= 8 else "",
                    "url":              _NARA_LIST_PAGE,  # /getItem 호출 후 실제 링크로 교체
                    "field":            "",
                    "ncs_codes":        "",
                    "employ_type":      type01,  # type01 코드 저장 → common_filter에서 판정
                    "recruit_division": "",
                    "region":           region_nm,
                    "body":             "",
                    "certificate":      "",
                    "prefer":           "",
                    "status":           "",
                    "pay":              "",
                })

        except Exception as e:
            logging.warning("나라일터(%s) 오류: %s", kwrd, e)
            continue

    stats = {"collected": len(jobs), "calls": call_count, "sort_order": sort_order}
    print(f"  나라일터: {len(jobs)}건 ({call_count}회 호출, Sort_order={sort_order})")
    return jobs, stats


def fetch_naraijari_detail(api_key: str, idx: str) -> dict:
    """
    나라일터 /getItem 상세조회 — 링크·본문 취득
    Returns: {"url": str, "contents": str}
    link01 → link02 → link03 → 목록페이지 폴백
    link 값이 http 없으면 https:// 자동 추가
    """
    enc_key = _quote(_unquote(api_key), safe="")
    url = f"{_NARA_ITEM_URL}?serviceKey={enc_key}&idx={idx}&resultType=xml"
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        _g = lambda tag: (root.findtext(f".//{tag}") or "").strip()

        raw_link = _g("link01") or _g("link02") or _g("link03") or ""
        if raw_link and not raw_link.startswith("http"):
            raw_link = "https://" + raw_link
        link = raw_link or _NARA_LIST_PAGE

        contents = _g("contents")
        return {"url": link, "contents": contents}
    except Exception as e:
        logging.warning("나라일터 /getItem 실패 idx=%s: %s", idx, e)
        return {"url": _NARA_LIST_PAGE, "contents": ""}


# ══════════════════════════════════════════════════════════════════════════════
# 수집 ④  철도산업정보센터 크롤러 (보조)
# ══════════════════════════════════════════════════════════════════════════════

def fetch_kric() -> list[dict]:
    jobs = []
    url = (
        "https://www.kric.go.kr/jsp/board/portal/sub03/org/"
        "recruitList.jsp?menuId=M080201"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table")
        if not table:
            print("  KRIC: 테이블 미발견")
            return []
        tbody = table.find("tbody") or table
        for row in tbody.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 4:
                continue
            link_tag = cols[1].find("a") if len(cols) > 1 else None
            if not link_tag:
                continue
            onclick = link_tag.get("href", "") + " " + link_tag.get("onclick", "")
            id_m = re.search(r"gotoDetail\((\d+)\)", onclick)
            if not id_m:
                continue
            board_seq = id_m.group(1)
            title    = link_tag.get_text(strip=True)
            org      = cols[2].get_text(strip=True) if len(cols) > 2 else ""
            deadline = cols[3].get_text(strip=True) if len(cols) > 3 else ""
            status   = cols[4].get_text(strip=True) if len(cols) > 4 else ""
            if "마감" in status and "진행" not in status:
                continue
            jobs.append({
                "id":               f"kric_{board_seq}",
                "source":           "철도산업정보센터",
                "source_type":      "철도산업정보센터",
                "title":            title,
                "org":              org,
                "inst_type":        "",
                "deadline":         deadline,
                "url": (
                    "https://www.kric.go.kr/jsp/employment/org/"
                    f"recruitDetail.jsp?board_seq={board_seq}"
                ),
                "field":            "",  # 키워드 매칭으로만 판정
                "ncs_codes":        "",
                "employ_type":      "",
                "recruit_division": "",
                "region":           "",
                "body":             "",
                "certificate":      "",
                "prefer":           "",
                "status":           "",
                "pay":              "",
            })
        print(f"  KRIC: {len(jobs)}건")
    except Exception as e:
        logging.warning("KRIC 오류: %s", e)
        print(f"  KRIC 오류: {e}")
    return jobs


# ══════════════════════════════════════════════════════════════════════════════
# 수집 ⑤  한국철도공사 채용 크롤러 (보조)
# ══════════════════════════════════════════════════════════════════════════════

def fetch_korail() -> list[dict]:
    jobs = []
    url = "https://info.korail.com/info/selectBbsNttList.do?bbsNo=198&key=733"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("table tbody tr") or soup.select(".board-list li")
        for row in rows:
            link = row.find("a")
            if not link:
                continue
            title = link.get_text(strip=True)
            if not title:
                continue
            href = link.get("href", "")
            full_url = f"https://info.korail.com{href}" if href.startswith("/") else href
            id_m = re.search(r"nttNo=(\d+)", href)
            job_id = f"korail_{id_m.group(1)}" if id_m else f"korail_{abs(hash(title))}"
            deadline = ""
            for td in row.find_all("td"):
                text = td.get_text(strip=True)
                if re.search(r"\d{4}[.\-]\d{2}[.\-]\d{2}", text):
                    deadline = text[:10]
                    break
            jobs.append({
                "id":               job_id,
                "source":           "한국철도공사",
                "source_type":      "한국철도공사",
                "title":            title,
                "org":              "한국철도공사",
                "inst_type":        "",
                "deadline":         deadline,
                "url":              full_url,
                "field":            "",  # 키워드 매칭으로만 판정
                "ncs_codes":        "",
                "employ_type":      "",
                "recruit_division": "",
                "region":           "서울",
                "body":             "",
                "certificate":      "",
                "prefer":           "",
                "status":           "",
                "pay":              "",
            })
        print(f"  한국철도공사: {len(jobs)}건")
    except Exception as e:
        logging.warning("코레일 오류: %s", e)
        print(f"  코레일 오류: {e}")
    return jobs


# ══════════════════════════════════════════════════════════════════════════════
# 중복 제거
# ══════════════════════════════════════════════════════════════════════════════

def dedup_jobs(jobs: list[dict]) -> tuple[list[dict], int]:
    """
    1차: API별 고유번호 (id 필드)
    2차: 기관명+공고제목 조합 해시
    Returns: (deduped_jobs, removed_count)
    """
    seen_ids: set[str] = set()
    seen_hashes: set[str] = set()
    result: list[dict] = []
    removed = 0

    for job in jobs:
        job_id = job["id"]
        h      = _job_hash(job)

        if job_id in seen_ids or h in seen_hashes:
            removed += 1
            continue

        seen_ids.add(job_id)
        seen_hashes.add(h)
        result.append(job)

    return result, removed


# ══════════════════════════════════════════════════════════════════════════════
# 공통 필터
# ══════════════════════════════════════════════════════════════════════════════

def common_filter(jobs: list[dict]) -> tuple[list[dict], list[tuple]]:
    """
    접수중 + 지역(서울/경기/인천) + 정규직/무기계약직 + 신입 단독 제외
    Returns: (passed, [(job, reason), ...])
    """
    common  = KW.get("common", {})
    regions = common.get("region", ["서울", "경기", "인천"])
    employ_ok = common.get("employ_include", ["정규직", "무기계약직"])
    title_ng  = common.get("title_exclude", ["청년인턴", "인턴"])

    passed: list[dict] = []
    rejected: list[tuple] = []

    for job in jobs:
        title  = job.get("title", "")
        status = job.get("status", "")
        employ = job.get("employ_type", "")
        div    = job.get("recruit_division", "")
        region = job.get("region", "")
        # "null" / "NULL" 문자열 정규화 → 빈 문자열로 처리 (필터 통과)
        if region and region.strip().lower() == "null":
            region = ""

        # ① 상태 (빈 칸이면 패스 — KRIC/Korail은 status 없음)
        # "Y"=잡알리오, "접수중"=나라일터/MOEF, "모집중"=KRID
        if status and status not in ("Y",) and "접수중" not in status and "모집중" not in status:
            rejected.append((job, f"마감·종료: status={status}"))
            continue

        # ② 지역 (빈 칸이면 패스)
        if region and not any(r in region for r in regions):
            rejected.append((job, f"지역외: {region[:30]}"))
            continue

        # ③ 고용형태 (빈 칸이면 패스)
        is_regular_confirmed = False  # 정규직 명시 여부 (True면 title_exclude 면제)
        if employ:
            source = job.get("source", "")
            if source == "나라일터":
                # 나라일터 type01 코드 판정
                # e01=공개경쟁, e02=경력경쟁, e06=공모직위 → 통과 (정규직 상당)
                # e03=계약직, e04=행정지원, e08=전문업무직 → 제외
                _nara_ng = {"e03", "e04", "e08"}
                if employ in _nara_ng:
                    rejected.append((job, f"비정규직(나라일터): {employ}"))
                    continue
                # e01/e02/e06 또는 미지정이면 정규직 확정 취급
                if employ in {"e01", "e02", "e06"}:
                    is_regular_confirmed = True
            else:
                # KRID/MOEF/KRIC: employ_type에 정규직/무기계약직 포함 여부
                if not any(e in employ for e in employ_ok):
                    rejected.append((job, f"비정규직: {employ[:30]}"))
                    continue
                is_regular_confirmed = True  # 위 체크 통과 = 정규직/무기계약직 확인됨

        # ④ 채용구분: "신입" 단독이면 제외 (신입+경력은 OK)
        if div and div.strip() == "신입":
            rejected.append((job, "신입 단독"))
            continue

        # ⑤ 제목 제외어 (청년인턴 등) — 정규직 명시 시 면제
        if not is_regular_confirmed:
            matched_ng = next((ng for ng in title_ng if ng in title), None)
            if matched_ng:
                rejected.append((job, f"제외어: {matched_ng}"))
                continue

        passed.append(job)

    return passed, rejected


# ══════════════════════════════════════════════════════════════════════════════
# 2트랙 매칭
# ══════════════════════════════════════════════════════════════════════════════

def match_tracks(jobs: list[dict]) -> list[dict]:
    """
    각 job에 track / matched_keywords / score / grade 추가
    반환: 1개 이상의 트랙에 매칭된 job 목록
    """
    a_kw      = KW.get("track_a", {})
    b_kw      = KW.get("track_b", {})

    a_ncs_auto    = a_kw.get("ncs_auto", ["R600020"])
    a_fields      = a_kw.get("field", ["정보통신"])
    a_include     = a_kw.get("include", [])
    a_exclude     = a_kw.get("exclude", [])

    b_include     = b_kw.get("include", [])
    b_exclude     = b_kw.get("exclude", [])

    result: list[dict] = []

    for _job in jobs:
        job    = dict(_job)  # copy — 원본 수정하지 않음
        field  = job.get("field", "")
        ncs    = job.get("ncs_codes", "")
        source = job.get("source", "")

        # 키워드 검색 텍스트 구성
        search_text = " ".join(filter(None, [
            job.get("title", ""),
            job.get("body", ""),
            job.get("certificate", ""),
            job.get("prefer", ""),
            job.get("org", ""),
        ]))

        # ── Track A ──────────────────────────────────────────────
        # 1차 확정: 정보통신 분야 OR R600020 NCS (출처 무관 — 키워드 매칭 필수)
        # KRIC/코레일 출처도 IT 무관 공고가 섞이므로 출처 1차확정 제거
        a_confirmed = (
            any(f in field for f in a_fields) or
            any(c in ncs for c in a_ncs_auto)
        )
        a_matched_kw = [k for k in a_include if k in search_text]
        a_excl       = any(k in search_text for k in a_exclude)

        track_a = False
        if a_confirmed and not a_excl:
            track_a = True          # 1차 확정 (키워드 불필요)
        elif a_matched_kw and not a_excl:
            track_a = True          # 키워드 매칭으로 A 확정

        # ── Track B ──────────────────────────────────────────────
        b_matched_kw = [k for k in b_include if k in search_text]
        b_excl       = any(k in search_text for k in b_exclude)

        # B는 항상 키워드 매칭 필요
        track_b = bool(b_matched_kw and not b_excl)

        # ── 결과 ─────────────────────────────────────────────────
        if not track_a and not track_b:
            continue

        # 트랙 라벨
        if track_a and track_b:
            track = "AB"
        elif track_a:
            track = "A"
        else:
            track = "B"

        # 매칭 키워드 합산 (중복 제거)
        all_kw = list(dict.fromkeys(
            (a_matched_kw if track_a else []) +
            (b_matched_kw if track_b else [])
        ))

        # 점수 계산: 키워드 수 / 1차확정은 최소 1
        a_score = len(a_matched_kw) if a_matched_kw else (1 if a_confirmed else 0)
        b_score = len(b_matched_kw)
        score   = max(a_score, b_score)

        job["track"]            = track
        job["matched_keywords"] = all_kw
        job["score"]            = score
        job["grade"]            = grade(score)
        job["days_left"]        = days_left(job.get("deadline", ""))

        result.append(job)

    return result


# ══════════════════════════════════════════════════════════════════════════════
# 제외 로그
# ══════════════════════════════════════════════════════════════════════════════

def write_filtered_log(rejected: list[tuple], date_str: str):
    """logs/filtered_YYYYMMDD.log 기록"""
    log_path = _LOG_DIR / f"filtered_{date_str}.log"
    lines = []
    for job, reason in rejected:
        lines.append(
            f"[{reason}] {job.get('org','?')} — {job.get('title','?')[:60]}"
        )
    log_path.write_text("\n".join(lines), encoding="utf-8")
    return len(lines)


def verify_link(url: str, timeout: int = 8) -> bool:
    """
    URL 유효성 검증 — HEAD 실패 시 GET fallback
    timeout=8초 (정부 사이트 일부 느림 대응)
    Returns True if accessible (status < 400), False otherwise
    """
    if not url or not url.startswith("http"):
        return False
    try:
        r = requests.head(url, timeout=timeout, allow_redirects=True,
                          headers=HEADERS)
        if r.status_code < 400:
            return True
        # HEAD 차단하는 서버 대응 — GET으로 재시도 (stream=True로 본문 최소화)
        with requests.get(url, timeout=timeout, allow_redirects=True,
                          headers=HEADERS, stream=True) as r2:
            return r2.status_code < 400
    except Exception:
        return False


def verify_links_and_log(jobs: list[dict], date_str: str) -> list[str]:
    """
    매칭 목록 전체 링크 검증. 실패 시 job["url"] = None.
    logs/link_check_YYYYMMDD.log 기록.
    반환: 로그 라인 목록
    """
    lines = []
    for j in jobs:
        url = j.get("url")
        if not url:
            lines.append(f"SKIP  [{j.get('org','?')}] url=None 이미 처리됨")
            continue
        ok = verify_link(url)
        org  = j.get("org", "?")[:20]
        titl = j.get("title", "?")[:35]
        if ok:
            lines.append(f"OK    [{org}] {titl} → {url[:80]}")
        else:
            lines.append(f"FAIL  [{org}] {titl} → {url[:80]}")
            j["url"] = None  # 링크 없음으로 표시

    log_path = _LOG_DIR / f"link_check_{date_str}.log"
    log_path.write_text("\n".join(lines), encoding="utf-8")
    return lines


# ══════════════════════════════════════════════════════════════════════════════
# HTML 이메일 리포트
# ══════════════════════════════════════════════════════════════════════════════

def _grade_badge(g: str) -> str:
    colors = {
        "상": ("#dc2626", "#fee2e2", "#fca5a5"),
        "중": ("#1d4ed8", "#dbeafe", "#93c5fd"),
        "하": ("#374151", "#f1f5f9", "#d1d5db"),
    }
    fg, bg, border = colors.get(g, colors["하"])
    return (
        f"<span style='display:inline-block;background:{bg};color:{fg};"
        f"border:1px solid {border};padding:1px 7px;border-radius:10px;"
        f"font-size:11px;font-weight:700;'>{g}</span>"
    )


def _source_badge(source_type: str) -> str:
    s = source_type or ""
    if "지방공기업" in s or "시도" in s:
        label, c = "지방공기업", "#0f766e"
    elif "중앙" in s or s == "":
        label, c = "공공기관", "#1d4ed8"
    elif "나라일터" in s:
        label, c = "나라일터", "#7c3aed"
    elif "철도" in s:
        label, c = "철도", "#b45309"
    else:
        label, c = "공공기관", "#374151"
    return (
        f"<span style='font-size:10px;color:{c};font-weight:600;"
        f"background:rgba(0,0,0,.05);padding:1px 5px;border-radius:4px;'>"
        f"[{label}]</span>"
    )


def build_html_report(matched: list[dict], today: str, title_prefix: str) -> str:
    total  = len(matched)
    urgent = [j for j in matched if (j.get("days_left") or 99) <= URGENT_DAYS]

    # ── 마감임박 섹션 ─────────────────────────────────────────────────────
    urgent_html = ""
    if urgent:
        rows = ""
        for j in urgent:
            kw_str = ", ".join(j.get("matched_keywords", [])[:4]) or "1차확정"
            _url = j.get("url")
            if _url:
                title_cell = (
                    f"<a href='{_url}' style='color:#dc2626;font-weight:700;"
                    f"text-decoration:none;'>{j['title'][:50]}</a>"
                )
            else:
                title_cell = (
                    f"<span style='color:#dc2626;font-weight:700;'>{j['title'][:50]}</span>"
                    f"<br><span style='font-size:10px;color:#9ca3af;'>"
                    f"링크 없음 — {j.get('org','기관')} 홈페이지 또는 나라일터에서 직접 검색</span>"
                )
            rows += (
                f"<tr style='background:#fff5f5;'>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;"
                f"font-weight:700;color:#dc2626;'>⚡ D-{j['days_left']}</td>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;'>"
                f"{title_cell}<br>"
                f"<span style='font-size:11px;color:#6b7280;'>{j['org']}</span></td>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;"
                f"font-size:11px;color:#374151;'>{kw_str}</td>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;"
                f"text-align:center;'>{_grade_badge(j['grade'])}</td>"
                f"</tr>"
            )
        urgent_html = f"""
<h3 style='color:#dc2626;margin:16px 0 8px;font-size:14px;'>
  ⚡ 마감임박 {URGENT_DAYS}일 이내 ({len(urgent)}건)
</h3>
<table width='100%' style='border-collapse:collapse;font-size:13px;margin-bottom:14px;'>
  <tr style='background:#7f1d1d;color:#fff;'>
    <th style='padding:7px 10px;text-align:left;width:60px;'>마감</th>
    <th style='padding:7px 10px;text-align:left;'>공고명</th>
    <th style='padding:7px 10px;text-align:left;width:130px;'>매칭어</th>
    <th style='padding:7px 10px;text-align:center;width:45px;'>등급</th>
  </tr>
  {rows}
</table>"""

    # ── 메인 공고 테이블 ──────────────────────────────────────────────────
    if not matched:
        main_html = "<p style='color:#666;padding:10px 0;'>오늘 새로운 매칭 공고가 없습니다.</p>"
    else:
        rows = ""
        for j in matched:
            d = j.get("days_left")
            if d is None:
                dl_str   = j.get("deadline") or "미정"
                dl_color = "#374151"
            elif d < 0:
                dl_str   = "마감"
                dl_color = "#9ca3af"
            elif d <= URGENT_DAYS:
                dl_str   = f"D-{d}"
                dl_color = "#dc2626"
            else:
                dl_str   = f"D-{d}"
                dl_color = "#374151"

            kw_str   = ", ".join(j.get("matched_keywords", [])[:5]) or "1차확정"
            field_nm = j.get("field", "") or ""
            extra    = " | ".join(filter(None, [
                f"분야: {field_nm}" if field_nm else "",
                f"매칭어: {kw_str}",
                j.get("employ_type", "")[:10] if j.get("employ_type") else "",
                j.get("recruit_division", "")[:8] if j.get("recruit_division") else "",
                j.get("region", "")[:10] if j.get("region") else "",
                f"연봉 {j['pay']}" if j.get("pay") else "",
            ]))

            _url = j.get("url")
            if _url:
                title_link = (
                    f"<a href='{_url}' style='color:#1a3a6b;text-decoration:none;"
                    f"font-weight:600;'>{j['title'][:55]}</a>"
                )
            else:
                title_link = (
                    f"<span style='color:#1a3a6b;font-weight:600;'>{j['title'][:55]}</span>"
                    f"&nbsp;<span style='font-size:10px;color:#9ca3af;font-weight:400;'>"
                    f"[링크없음 — {j.get('org','기관')} 홈페이지·나라일터 직접 검색]</span>"
                )
            rows += (
                f"<tr>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;text-align:center;'>"
                f"  {_grade_badge(j['grade'])}</td>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;'>"
                f"  {_source_badge(j.get('source_type',''))}&nbsp;"
                f"  {title_link}<br>"
                f"  <span style='font-size:11px;color:#6b7280;'>"
                f"    {j['org']} &nbsp;·&nbsp; {extra}"
                f"  </span></td>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;"
                f"  font-size:12px;font-weight:{'700' if (d or 99)<=URGENT_DAYS else '400'};"
                f"  color:{dl_color};white-space:nowrap;'>{dl_str}</td>"
                f"</tr>"
            )

        main_html = f"""
<table width='100%' style='border-collapse:collapse;font-size:13px;'>
  <tr style='background:#1a3a6b;color:#fff;'>
    <th style='padding:8px 10px;text-align:center;width:45px;'>등급</th>
    <th style='padding:8px 10px;text-align:left;'>공고명 &amp; 정보</th>
    <th style='padding:8px 10px;text-align:left;width:60px;'>마감</th>
  </tr>
  {rows}
</table>"""

    html = f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
             background:#f0f4f8;padding:20px;margin:0;">
<div style="max-width:740px;margin:0 auto;background:#fff;border-radius:10px;
            overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
  <!-- 헤더 -->
  <div style="background:linear-gradient(135deg,#1a3a6b,#0f2a52);padding:18px 22px;">
    <div style="font-size:11px;color:#93c5fd;font-weight:600;letter-spacing:1px;
                margin-bottom:5px;">DAILY JOB REPORT · {title_prefix}</div>
    <div style="font-size:20px;font-weight:800;color:#fff;">{today}</div>
    <div style="font-size:12px;color:#bdd4f5;margin-top:5px;">
      신규 매칭 &nbsp;<strong style="color:#fff;font-size:16px;">{total}건</strong>
      &nbsp;|&nbsp; 마감임박 <strong style="color:#f87171;">{len(urgent)}건</strong>
    </div>
  </div>
  <!-- 본문 -->
  <div style="padding:18px 22px;">
    {urgent_html}
    <h3 style="color:#1a3a6b;margin:0 0 10px;font-size:14px;font-weight:700;">
      📋 신규 매칭 공고 ({total}건)
    </h3>
    {main_html}
  </div>
  <!-- 푸터 -->
  <div style="background:#f0f5fb;padding:11px 22px;font-size:11px;
              color:#9ca3af;border-top:1px solid #d0dcea;">
    자동 발송 · job_monitor.py v2 · GitHub Actions
    &nbsp;|&nbsp; 수신거부: 워크플로우 비활성화
  </div>
</div>
</body></html>"""
    return html


# ══════════════════════════════════════════════════════════════════════════════
# 이메일 발송
# ══════════════════════════════════════════════════════════════════════════════

def send_email(
    html: str, subject: str,
    to_list: list[str], to_header: str,
    preview_filename: str = "report_preview.html",
) -> bool:
    """발송 성공 True, 실패 False 반환 (미설정·수신자없음은 True 취급)"""
    if not GMAIL_USER or not GMAIL_PASSWORD:
        out_path = _BASE / preview_filename
        print(f"\n[이메일 미설정] 미리보기 저장: {out_path}")
        out_path.write_text(html, encoding="utf-8")
        return True
    if not to_list:
        print(f"  [건너뜀] 수신자 없음: {subject}")
        return True

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = GMAIL_USER
    msg["To"]      = to_header
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_USER, GMAIL_PASSWORD)
            server.sendmail(GMAIL_USER, to_list, msg.as_string())
        print(f"✉️  발송 완료 → {to_header}")
        return True
    except Exception as e:
        logging.warning("이메일 발송 실패: %s", e)
        print(f"이메일 발송 실패: {e}", file=sys.stderr)
        return False


# ══════════════════════════════════════════════════════════════════════════════
# 실행 통계 (run_stats.json) — KRID 실패율 주간 관찰용
# ══════════════════════════════════════════════════════════════════════════════

def load_run_stats() -> list[dict]:
    """run_stats.json 로드. 없거나 파싱 오류 시 빈 리스트."""
    if not RUN_STATS_FILE.exists():
        return []
    try:
        return json.loads(RUN_STATS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_run_stats(stats_list: list[dict]) -> None:
    """run_stats.json 저장. _RUN_STATS_KEEP일 초과 항목 자동 삭제."""
    cutoff = (datetime.utcnow() - timedelta(days=_RUN_STATS_KEEP)).strftime("%Y-%m-%dT")
    trimmed = [r for r in stats_list if r.get("ts", "") >= cutoff]
    RUN_STATS_FILE.write_text(
        json.dumps(trimmed, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def send_weekly_summary(recipients: list[str], reply_to: str) -> None:
    """KST 월요일 실행 시 지난 주(월~금) KRID 실패 통계 이메일 발송."""
    stats_list = load_run_stats()
    kst_now = datetime.utcnow() + timedelta(hours=9)

    # 지난 주 월~금 KST 범위
    mon_kst = kst_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=kst_now.weekday())
    last_mon_kst = mon_kst - timedelta(days=7)
    last_fri_end_kst = mon_kst - timedelta(days=3, seconds=1)  # 금요일 23:59:59

    # UTC ISO 문자열로 비교 (ts 필드가 UTC)
    last_mon_utc = (last_mon_kst - timedelta(hours=9)).strftime("%Y-%m-%dT")
    last_fri_utc = (last_fri_end_kst - timedelta(hours=9)).strftime("%Y-%m-%dT%H:%M:%S")

    week_records = [
        r for r in stats_list
        if last_mon_utc <= r.get("ts", "") <= last_fri_utc
    ]

    week_label = (
        f"{last_mon_kst.strftime('%Y-%m-%d')} ~ "
        f"{(mon_kst - timedelta(days=3)).strftime('%Y-%m-%d')}"
    )

    if not week_records:
        print(f"  주간 요약: 지난 주({week_label}) 실행 기록 없음 — 발송 건너뜀")
        return

    total_runs    = len(week_records)
    # "완전 실패" = 서울·인천·경기 3개 시도 모두 실패한 실행
    krid_fail_runs = sum(
        1 for r in week_records
        if r.get("krid_fail", 0) > 0 and r.get("krid_ok", 0) == 0
    )
    krid_collected = sum(r.get("krid_collected", 0) for r in week_records)
    fail_rate      = krid_fail_runs / total_runs if total_runs else 0
    ok_pct         = f"{(1 - fail_rate):.0%}"

    warn_html = (
        f'<p style="color:#c00;font-weight:bold">'
        f'⚠️ KRID 실패율 {fail_rate:.0%} — 로컬 보험 실행 검토 필요</p>'
        if fail_rate >= 0.30 else ""
    )

    html_body = f"""<html><body style="font-family:sans-serif;max-width:580px;margin:auto;padding:16px">
<h2 style="margin-bottom:4px">📊 주간 채용 모니터링 요약</h2>
<p style="color:#888;margin-top:0">{week_label}</p>
<table style="border-collapse:collapse;width:100%;margin-bottom:12px">
  <tr style="background:#f5f5f5">
    <th style="padding:8px 12px;text-align:left;font-weight:normal">항목</th>
    <th style="padding:8px 12px;text-align:right;font-weight:normal">결과</th>
  </tr>
  <tr>
    <td style="padding:8px 12px;border-bottom:1px solid #eee">실행 횟수</td>
    <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eee">{total_runs}회</td>
  </tr>
  <tr>
    <td style="padding:8px 12px;border-bottom:1px solid #eee">KRID 완전 실패</td>
    <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eee;
               color:{'#c00' if krid_fail_runs > 0 else '#090'}">
      {krid_fail_runs}회 / {total_runs}회
    </td>
  </tr>
  <tr>
    <td style="padding:8px 12px;border-bottom:1px solid #eee">성공률</td>
    <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eee">{ok_pct}</td>
  </tr>
  <tr>
    <td style="padding:8px 12px">수집 합계 (KRID)</td>
    <td style="padding:8px 12px;text-align:right">{krid_collected}건</td>
  </tr>
</table>
{warn_html}
<p style="color:#aaa;font-size:11px">
  ※ 완전 실패 기준: 서울·인천·경기 3개 시도 모두 타임아웃<br>
  ※ 판단 기준: 실패율 30% 이상 시 로컬 보험 실행 검토
</p>
</body></html>"""

    subj = (
        f"[주간] 채용 모니터링 KRID "
        f"실패 {krid_fail_runs}회/{total_runs}회 ({week_label})"
    )
    send_email(html_body, subj, recipients, reply_to,
               preview_filename="weekly_summary.html")
    print(f"  주간 요약 발송: KRID 실패 {krid_fail_runs}/{total_runs}회 ({week_label})")


# ══════════════════════════════════════════════════════════════════════════════
# 메인
# ══════════════════════════════════════════════════════════════════════════════

def main():
    now      = datetime.now()
    today_str = now.strftime("%Y년 %m월 %d일 (%a)")
    date_str  = now.strftime("%Y%m%d")

    print("=" * 50)
    print(f"채용공고 모니터링  {now.strftime('%Y-%m-%d %H:%M')}")
    print("=" * 50)

    seen = load_seen()
    print(f"기존 확인 공고: {len(seen)}건\n")

    # ── 수집 ─────────────────────────────────────────────────────────────────
    print("【수집】")

    all_jobs: list[dict] = []
    stats: dict = {}

    # ① 지역정보개발원 (서울·인천·경기)
    # SKIP_KRID=1 환경변수: GitHub Actions(해외IP) 등 타임아웃 환경에서 건너뜀
    krid_total = 0
    krid_fields: list[str] = []
    krid_failed_count = 0  # 시도별 실패 횟수 추적
    if os.environ.get("SKIP_KRID", "").strip() == "1":
        print("  [SKIP_KRID=1] 지역정보개발원 수집 건너뜀 (해외IP 차단)")
    else:
        for sido_nm, sido_cd in SIDO_CODES.items():
            try:
                jobs_s, fields, ok = fetch_krid(DATAGOKR_API_KEY, sido_cd, sido_nm)
            except Exception as e:
                logging.warning("KRID(%s) 예외: %s", sido_nm, e)
                jobs_s, fields, ok = [], [], False
            if not ok:
                krid_failed_count += 1
                logging.warning("KRID(%s) 수집 실패 — 해당 공고 seen_ids 미등록", sido_nm)
            all_jobs += jobs_s
            krid_total += len(jobs_s)
            if not krid_fields and fields:
                krid_fields = fields
    stats["krid"] = {"collected": krid_total, "actual_fields": krid_fields,
                     "failed": krid_failed_count}

    # ② 재정경제부
    try:
        moef_jobs, moef_stats = fetch_moef(DATAGOKR_API_KEY, max_pages=10)
    except Exception as e:
        logging.warning("MOEF 예외: %s", e)
        moef_jobs, moef_stats = [], {}
    all_jobs += moef_jobs
    stats["moef"] = moef_stats

    # ③ 인사혁신처 나라일터 (DATAGOKR_API_KEY로 통일 — data.go.kr 동일 계정)
    nara_kwrd = KW.get("naraijari_kwrd", ["전산", "정보통신", "보안"])
    try:
        nara_jobs, nara_stats = fetch_naraijari(DATAGOKR_API_KEY, nara_kwrd)
    except Exception as e:
        logging.warning("나라일터 예외: %s", e)
        nara_jobs, nara_stats = [], {}
    all_jobs += nara_jobs
    stats["naraijari"] = nara_stats

    # ④ 철도산업정보센터
    try:
        kric_jobs = fetch_kric()
    except Exception as e:
        logging.warning("KRIC 예외: %s", e)
        kric_jobs = []
    all_jobs += kric_jobs

    # ⑤ 한국철도공사
    try:
        korail_jobs = fetch_korail()
    except Exception as e:
        logging.warning("코레일 예외: %s", e)
        korail_jobs = []
    all_jobs += korail_jobs

    print(f"  합계: {len(all_jobs)}건 (중복제거 전)")

    # ── 중복 제거 ─────────────────────────────────────────────────────────
    all_jobs, dup_count = dedup_jobs(all_jobs)
    print(f"\n【필터】")
    print(f"  중복 제거: {dup_count}건 → 유효 {len(all_jobs)}건")

    # ── 신규 필터 ────────────────────────────────────────────────────────
    new_jobs = [j for j in all_jobs if j["id"] not in seen]
    print(f"  신규: {len(new_jobs)}건 (기존 seen_ids 제외)")

    # ── 공통 필터 ─────────────────────────────────────────────────────────
    passed, rejected = common_filter(new_jobs)
    print(f"  공통 통과: {len(passed)}건 / 제외: {len(rejected)}건")

    # ── 나라일터 2단계: common_filter 통과 전체에 /getItem → body 보강 후 매칭 ──
    # 목록 title만으로 놓치는 공고를 contents로 최종 확정
    nara_passed = [j for j in passed if j.get("source") == "나라일터"]
    if nara_passed:
        print(f"  나라일터 /getItem 조회: {len(nara_passed)}건 (2단계 본문 보강)")
        for j in nara_passed:
            idx = j["id"].replace("naraijari_", "")
            detail = fetch_naraijari_detail(DATAGOKR_API_KEY, idx)
            real_url = detail["url"]
            if real_url == _NARA_LIST_PAGE:
                j["url"] = None
            else:
                j["url"] = real_url
            if detail.get("contents"):
                j["body"] = detail["contents"][:800]

    # ── 2트랙 매칭 ────────────────────────────────────────────────────────
    matched_all = match_tracks(passed)
    matched_a = [j for j in matched_all if "A" in j.get("track", "")]
    matched_b = [j for j in matched_all if "B" in j.get("track", "")]

    # 트랙별 정렬 (점수 높은 순 → 마감일 가까운 순)
    matched_a.sort(key=lambda j: (-j.get("score", 0), j.get("days_left") or 999))
    matched_b.sort(key=lambda j: (-j.get("score", 0), j.get("days_left") or 999))

    print(f"  트랙A 매칭: {len(matched_a)}건")
    print(f"  트랙B 매칭: {len(matched_b)}건")

    # ── 발송 전 링크 검증 ─────────────────────────────────────────────────
    print(f"  링크 검증 중... ({len(matched_all)}건)")
    link_lines = verify_links_and_log(matched_all, date_str)
    fail_cnt = sum(1 for ln in link_lines if ln.startswith("FAIL"))
    print(f"  → logs/link_check_{date_str}.log ({len(link_lines)}건, 실패={fail_cnt})")

    # 키워드 통계 (트랙A)
    kw_counter: dict[str, int] = {}
    for j in matched_a:
        for kw in j.get("matched_keywords", []):
            kw_counter[kw] = kw_counter.get(kw, 0) + 1

    # ── 제외 로그 ─────────────────────────────────────────────────────────
    n_filtered = write_filtered_log(rejected, date_str)
    print(f"  → logs/filtered_{date_str}.log ({n_filtered}건)")

    # ── 이메일 발송 ───────────────────────────────────────────────────────
    print("\n【발송】")
    send_ok_a = True   # 매칭 없으면 기본 True (저장 OK)
    send_ok_b = True

    # 트랙A (본인 — 전산·통신직)
    if matched_a:
        html_a   = build_html_report(matched_a, today_str, "전산·통신·IT직 채용 모니터링")
        urgent_cnt = sum(1 for j in matched_a if (j.get("days_left") or 99) <= URGENT_DAYS)
        subj_a   = (
            f"[채용] {now.strftime('%m/%d')} 전산/통신 신규 {len(matched_a)}건"
            + (f" ⚡D↓{urgent_cnt}건" if urgent_cnt else "")
        )
        send_ok_a = send_email(html_a, subj_a, EMAIL_TO_LIST, EMAIL_TO,
                               preview_filename="report_preview_tech.html")
    else:
        print("  트랙A 매칭 없음 — 발송 건너뜀")

    # 트랙B (동료 — 행정·계약·회계)
    if matched_b:
        html_b   = build_html_report(matched_b, today_str, "행정·계약·회계·재무직 채용 모니터링")
        urgent_cnt_b = sum(1 for j in matched_b if (j.get("days_left") or 99) <= URGENT_DAYS)
        subj_b   = (
            f"[채용] {now.strftime('%m/%d')} 행정직 신규 {len(matched_b)}건"
            + (f" ⚡D↓{urgent_cnt_b}건" if urgent_cnt_b else "")
        )
        if EMAIL_TO_ADMIN_LIST:
            send_ok_b = send_email(html_b, subj_b, EMAIL_TO_ADMIN_LIST, EMAIL_TO_ADMIN,
                                   preview_filename="report_preview_admin.html")
        else:
            out_path = _BASE / "report_preview_admin.html"
            print(f"  트랙B: 동료 이메일 미설정 — preview 저장: {out_path}")
            out_path.write_text(html_b, encoding="utf-8")
    else:
        print("  트랙B 매칭 없음 — 발송 건너뜀")

    # ── seen_ids 갱신 — 발송 성공(또는 매칭 0건)일 때만 저장 ────────────
    # KRID 실패 시: 해당 공고는 seen_ids 미등록 → 다음 실행에서 재수집
    if send_ok_a and send_ok_b:
        ids_to_save = set()
        for j in new_jobs:
            jid = j["id"]
            # KRID 공고 중 실패한 시도분은 krid_failed_count > 0이면 전체 보수적으로 제외
            # (어느 시도에서 실패했는지 공고 단위로 알 수 없으므로, 실패 있으면 KRID 전체 미등록)
            if jid.startswith("krid_") and krid_failed_count > 0:
                continue
            ids_to_save.add(jid)
        seen.update(ids_to_save)
        save_seen(seen)
        if krid_failed_count > 0:
            print(f"⚠️  KRID {krid_failed_count}개 시도 실패 — 해당 공고 seen_ids 미등록 (다음 실행 재수집)")
    else:
        logging.error("이메일 발송 실패 — seen_ids 미갱신 (다음 실행에서 재시도)")
        print("⚠️  발송 실패 — seen_ids 미갱신, 다음 실행에서 재시도", file=sys.stderr)

    # ── 실행 로그 출력 ────────────────────────────────────────────────────
    print(f"""
{'='*50}
채용공고 모니터링  {now.strftime('%Y-%m-%d %H:%M')}
{'='*50}
【수집】
  지역정보개발원(서울)   {stats.get('krid',{}).get('collected',0)//len(SIDO_CODES) if SIDO_CODES else 0}건 (추정)
  지역정보개발원 합계    {stats.get('krid',{}).get('collected',0)}건
  재정경제부            {stats.get('moef',{}).get('collected',0)}건
  인사혁신처            {stats.get('naraijari',{}).get('collected',0)}건
  KRIC/코레일           {len(kric_jobs)+len(korail_jobs)}건
  합계                  {len(all_jobs)+dup_count}건

【필터】
  중복 제거   {dup_count}건
  공통 통과   {len(passed)}건
  트랙A 매칭  {len(matched_a)}건
  트랙B 매칭  {len(matched_b)}건
  제외        {len(rejected)}건 → logs/filtered_{date_str}.log

【신규】
  트랙A {len(matched_a)}건 / 트랙B {len(matched_b)}건

【트래픽】
  재정경제부 {stats.get('moef',{}).get('pages_fetched',0)*100}/1000 (일일한도)
  인사혁신처 {stats.get('naraijari',{}).get('calls',0)*100}/10000

【정렬방향 확인】
  재정경제부: {stats.get('moef',{}).get('sort_direction','미확인')}
  재정경제부 첫 SN 5개: {stats.get('moef',{}).get('first_sns',[])}
  나라일터: Sort_order={stats.get('naraijari',{}).get('sort_order','?')}

【KRID 실제 필드명】
  {stats.get('krid',{}).get('actual_fields', '첫 호출 실패')}
{'='*50}""")

    # ── 완료 보고 표 ──────────────────────────────────────────────────────
    krid_fields_check = stats.get("krid", {}).get("actual_fields", [])
    doc_fields = ["no","instNm","instType","instCls","sido","title","recruitStatus",
                  "recruitYear","recruitField","recruitCnt","recruitDivision",
                  "employType","position","pay","workTime","workPlace","jobDetail",
                  "retireAge","screenMethod","areaLimit","certificate","prefer",
                  "receiptStart","receiptClose","receiptMethod","contact",
                  "document","linkUrl","instAddr","modDate"]
    field_match = "일치" if set(krid_fields_check) == set(doc_fields) else (
        f"불일치 — 실제: {krid_fields_check[:5]}..." if krid_fields_check else "첫 호출 실패"
    )

    print(f"""
▣ 완료 보고
┌────────────────────────────────┬─────────────────────────────────┐
│ 항목                           │ 결과                            │
├────────────────────────────────┼─────────────────────────────────┤
│ 지역정보개발원 수집            │ {stats.get('krid',{}).get('collected',0)}건              │
│ KRID 수집 실패                 │ {stats.get('krid',{}).get('failed',0)}건 / {len(SIDO_CODES)}시도         │
│ KRID 실제 필드명               │ {field_match[:30]}         │
│ 재정경제부 수집                │ {stats.get('moef',{}).get('collected',0)}건              │
│ 재정경제부 정렬방향            │ {stats.get('moef',{}).get('sort_direction','?')[:30]}│
│ 인사혁신처 수집                │ {stats.get('naraijari',{}).get('collected',0)}건              │
│ 트랙A 매칭                     │ {len(matched_a)}건              │
│ 트랙B 매칭                     │ {len(matched_b)}건              │
│ 중복 제거                      │ {dup_count}건              │
│ keywords.json                  │ 완료                            │
│ sido_codes.json                │ 완료                            │
│ Actions 버전                   │ checkout@v5 / setup-python@v6   │
│ 재정경제부 일일 트래픽         │ {stats.get('moef',{}).get('pages_fetched',0)*100}/1000          │
│ 인사혁신처 일일 트래픽         │ {stats.get('naraijari',{}).get('calls',0)*100}/10000         │
└────────────────────────────────┴─────────────────────────────────┘

▣ 트랙A 매칭 공고 목록""")

    for j in matched_a:
        print(f"  [{j.get('source_type','')}] {j['org']} — {j['title'][:50]}")
        print(f"    매칭어: {', '.join(j.get('matched_keywords',[]))[:60]} | D-{j.get('days_left','?')}")

    print("\n▣ 제외 샘플 (최대 20건)")
    for job, reason in rejected[:20]:
        print(f"  [{reason}] {job.get('org','?')} — {job.get('title','?')[:45]}")

    # ── run_stats.json 기록 ──────────────────────────────────────────────
    run_record = {
        "ts":             now.strftime("%Y-%m-%dT%H:%M:%S"),  # UTC
        "krid_ok":        len(SIDO_CODES) - krid_failed_count,
        "krid_fail":      krid_failed_count,
        "krid_collected": stats.get("krid", {}).get("collected", 0),
    }
    rs_list = load_run_stats()
    rs_list.append(run_record)
    save_run_stats(rs_list)

    # ── 주간 요약 (KST 월요일 실행 시 지난 주 통계 발송) ────────────────
    kst_now = now + timedelta(hours=9)
    if kst_now.weekday() == 0:  # 0 = 월요일
        print("  [주간 요약] KST 월요일 — 지난 주 KRID 통계 발송...")
        send_weekly_summary(EMAIL_TO_LIST, EMAIL_TO)

    print("\n완료.")


if __name__ == "__main__":
    main()
