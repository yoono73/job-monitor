#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
채용공고 자동 모니터링 — job_monitor.py
실행: GitHub Actions 매일 KST 07:00 (UTC 22:00 전날)
로컬 테스트: python job_monitor.py
"""

import os
import json
import re
import smtplib
import sys
from datetime import datetime, date, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ═══════════════════════════════════════════
# 환경변수 (GitHub Actions Secrets에서 주입)
# ═══════════════════════════════════════════
_EMAIL_TO_RAW       = os.environ.get("EMAIL_TO", "yoono73@gmail.com")
_EMAIL_TO_ADMIN_RAW = os.environ.get("EMAIL_TO_ADMIN", "")   # 동료 이메일 (행정직 전용)

EMAIL_TO_LIST       = [e.strip() for e in _EMAIL_TO_RAW.split(",") if e.strip()]
EMAIL_TO_ADMIN_LIST = [e.strip() for e in _EMAIL_TO_ADMIN_RAW.split(",") if e.strip()]

EMAIL_TO       = ", ".join(EMAIL_TO_LIST)
EMAIL_TO_ADMIN = ", ".join(EMAIL_TO_ADMIN_LIST)

GMAIL_USER      = os.environ.get("GMAIL_USER",         "")
GMAIL_PASSWORD  = os.environ.get("GMAIL_APP_PASSWORD", "")
ALIO_API_KEY    = os.environ.get("ALIO_API_KEY",       "")

SEEN_IDS_FILE   = Path("seen_ids.json")

# ═══════════════════════════════════════════
# 매칭 설정 — 본인 (전산/통신직)
# ═══════════════════════════════════════════
KEYWORDS = {
    "AFC":        5,
    "자동요금":   5,
    "LTE-R":      5,
    "LTE_R":      4,
    "철도통신":   4,
    "통신직":     3,
    "전산직":     3,
    "정보통신":   3,
    "SDH":        3,
    "광전송":     3,
    "관제시스템": 2,
    "정보시스템": 2,
    "네트워크":   2,
    "보안":       1,
    "통신":       1,
}

TARGET_ORGS = {
    "한국철도공사": 5,
    "코레일":       5,
    "국가철도공단": 5,
    "서울교통공사": 5,
    "인천교통공사": 4,
    "경기교통공사": 4,
    "수서고속철도": 3,
    "SR":           3,
    "위례트램":         3,
    "신림선도시철도":   3,
    "동북선도시철도":   3,
    "서울시메트로9호선": 3,
    "GTX":              3,
    "김포골드라인":     2,
    "의정부경전철":     2,
    "용인에버라인":     2,
    "한국교통안전공단": 2,
    "서울시설공단":     2,
    "한국스마트카드":   2,
    "한국철도기술연구원": 2,
    "한국전자통신연구원": 1,
    "한국지능정보사회진흥원": 1,
    "한국인터넷진흥원": 1,
    "한국공항공사":     2,
    "인천국제공항":     2,
    "부산교통공사":     2,
    "대구교통공사":     2,
    "광주교통공사":     2,
    "대전교통공사":     2,
    "서울도시철도":     2,
    "한국도로공사":     1,
    "한국전력공사":     1,
    "한국수자원공사":   1,
    "한국토지주택공사": 1,
}

MIN_SCORE = 1   # 이 점수 이상만 리포트에 포함

# ═══════════════════════════════════════════
# 매칭 설정 — 동료 (행정직: 계약/예산/회계/재무)
# ═══════════════════════════════════════════
ADMIN_KEYWORDS = {
    # 핵심 — 직무명이 포함된 경우
    "계약":     5,   # 계약 담당, 계약관리
    "예산":     5,   # 예산관리, 예산기획
    "회계":     5,   # 회계담당, 재무회계
    "재무":     5,   # 재무팀, 재무관리
    "조달":     4,   # 조달관리, 구매조달
    "경리":     4,   # 경리담당
    "원가":     3,   # 원가관리
    "세무":     3,   # 세무관리
    "내부감사": 3,
    "감사":     2,
    "기획":     2,
    "행정":     2,
    "총무":     2,
    "인사":     1,
    "경영":     1,
}

# TARGET_ORGS는 두 사람 공통 사용
# 동료는 키워드 점수만으로 필터 (기관명 구분 없이 공공기관 전체)
MIN_ADMIN_SCORE = 3  # 행정직은 기준 높게 (잡음 제거)

URGENT_DAYS = 7

# ═══════════════════════════════════════════
# 유틸리티
# ═══════════════════════════════════════════
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
}

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

def score_job(title: str, org: str) -> int:
    s = sum(w for k, w in KEYWORDS.items() if k in title)
    s += sum(w for k, w in TARGET_ORGS.items() if k in org)
    return s

def score_admin(title: str, org: str) -> int:
    """행정직 점수: 직무 키워드만 (기관명 보너스 없음 — 전체 공공기관 대상)"""
    return sum(w for k, w in ADMIN_KEYWORDS.items() if k in title or k in org)

def grade(score: int) -> str:
    if score >= 7:
        return "상"
    if score >= 3:
        return "중"
    return "하"

def days_left(deadline_str: str) -> int | None:
    if not deadline_str:
        return None
    for fmt in ("%Y.%m.%d", "%Y-%m-%d", "%Y%m%d"):
        try:
            d = datetime.strptime(deadline_str.strip()[:10], fmt).date()
            return (d - date.today()).days
        except ValueError:
            continue
    return None

# ═══════════════════════════════════════════
# 크롤러 1: 철도산업정보센터
# ═══════════════════════════════════════════
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
            print("  kric: 테이블 미발견")
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
                "id":       f"kric_{board_seq}",
                "source":   "철도산업정보센터",
                "title":    title,
                "org":      org,
                "deadline": deadline,
                "url": (
                    "https://www.kric.go.kr/jsp/emplovment/org/"
                    f"recruitDetail.jsp?board_seq={board_seq}"
                ),
            })
        print(f"  kric: {len(jobs)}건 수집")
    except Exception as e:
        print(f"  kric 오류: {e}")
    return jobs

# ═══════════════════════════════════════════
# 크롤러 2: 잡알리오 Open API
# ═══════════════════════════════════════════
def fetch_alio_api() -> list[dict]:
    if not ALIO_API_KEY:
        print("  잡알리오 API: 키 미설정 (건너뜀)")
        return []
    jobs = []
    url = "https://apis.data.go.kr/B552468/AlioInnoJob/getJobInfo"
    params = {
        "serviceKey": ALIO_API_KEY,
        "numOfRows":  100,
        "pageNo":     1,
        "returnType": "json",
    }
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        items = (
            data.get("response", {})
                .get("body", {})
                .get("items", {})
                .get("item", [])
        )
        if isinstance(items, dict):
            items = [items]
        for item in items:
            job_id   = str(item.get("recrutPblntSn") or item.get("pbancNo") or "")
            title    = item.get("recrutNm") or item.get("pbancNm") or ""
            org      = item.get("instNm") or ""
            deadline = item.get("rcptDdln") or item.get("pbancEndDt") or ""
            detail   = item.get("recrutPblntSn") or ""
            if not title:
                continue
            jobs.append({
                "id":       f"alio_{job_id}",
                "source":   "잡알리오",
                "title":    title,
                "org":      org,
                "deadline": deadline,
                "url":      f"https://job.alio.go.kr/recruitview.do?pbancNo={detail}",
            })
        print(f"  잡알리오 API: {len(jobs)}건 수집")
    except Exception as e:
        print(f"  잡알리오 API 오류: {e}")
    return jobs

# ═══════════════════════════════════════════
# 크롤러 3: 잡알리오 웹 크롤링 (공통 함수)
# ═══════════════════════════════════════════
def _fetch_alio_pages(area_codes: list[str], label: str) -> list[dict]:
    """
    잡알리오 웹 크롤링 공통 함수
    area_codes: 직종 코드 목록 (예: ["R8018", "R8002"])
    label: 로그용 레이블
    """
    jobs = []
    seen_ids = set()
    today = date.today()
    s_date = (today - timedelta(days=60)).strftime("%Y.%m.%d")
    e_date = today.strftime("%Y.%m.%d")
    base_url = "https://job.alio.go.kr/recruit.do"

    for area in area_codes:
        for page in range(1, 6):
            params = {
                "pageNo":   str(page),
                "s_date":   s_date,
                "e_date":   e_date,
                "area":     area,
                "order":    "REG_DATE",
                "sort":     "DESC",
                "pageSet":  "50",
            }
            try:
                resp = requests.get(base_url, params=params, headers=HEADERS, timeout=20)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")
                job_links = soup.select("td a[href*='recruitview.do']")
                if not job_links:
                    break
                for link in job_links:
                    href  = link.get("href", "")
                    title = link.get_text(strip=True)
                    m = re.search(r"idx=(\d+)", href)
                    if not m:
                        continue
                    idx    = m.group(1)
                    job_id = f"alio_{idx}"
                    if job_id in seen_ids:
                        continue
                    seen_ids.add(job_id)
                    url = f"https://job.alio.go.kr/recruitview.do?idx={idx}"
                    row = link.find_parent("tr")
                    if not row:
                        continue
                    cols = row.find_all("td")
                    org          = cols[2].get_text(strip=True) if len(cols) > 2 else ""
                    deadline_raw = cols[6].get_text(strip=True) if len(cols) > 6 else ""
                    deadline     = re.sub(r"\s*D[-–]\d+.*$", "", deadline_raw).strip()
                    status       = cols[7].get_text(strip=True) if len(cols) > 7 else ""
                    if "마감" in status:
                        continue
                    jobs.append({
                        "id":       job_id,
                        "source":   "잡알리오",
                        "title":    title,
                        "org":      org,
                        "deadline": deadline,
                        "url":      url,
                    })
            except Exception as e:
                print(f"  잡알리오 {label} area={area} page={page} 오류: {e}", file=sys.stderr)
                break

    print(f"  잡알리오 {label}: {len(jobs)}건 수집")
    return jobs


def fetch_alio_web_tech() -> list[dict]:
    """본인용: 전산직(R8018) — 철도·IT 공공기관"""
    return _fetch_alio_pages(["R8018"], "전산직")


def fetch_alio_web_admin() -> list[dict]:
    """
    동료용: 행정직(R8002) + 경영직(R8003) + 사무직(R8004)
    잡알리오 = 공공기관·준정부기관·기타공공기관만 포함 (지방공기업은 별도)
    """
    return _fetch_alio_pages(["R8002", "R8003", "R8004"], "행정·경영·사무직")


# ═══════════════════════════════════════════
# 크롤러 4: 한국철도공사 채용
# ═══════════════════════════════════════════
def fetch_korail() -> list[dict]:
    jobs = []
    url = "https://info.korail.com/info/selectBbsNttList.do?bbsNo=198&key=733"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("table tbody tr")
        if not rows:
            rows = soup.select(".board-list li, .bbs-list li")
        for row in rows:
            link = row.find("a")
            if not link:
                continue
            title = link.get_text(strip=True)
            if not title:
                continue
            href = link.get("href", "")
            full_url = (
                f"https://info.korail.com{href}"
                if href.startswith("/")
                else href
            )
            id_m = re.search(r"nttNo=(\d+)", href)
            job_id = f"korail_{id_m.group(1)}" if id_m else f"korail_{abs(hash(title))}"
            deadline = ""
            for td in row.find_all("td"):
                text = td.get_text(strip=True)
                if re.search(r"\d{4}[.\-]\d{2}[.\-]\d{2}", text):
                    deadline = text[:10]
                    break
            jobs.append({
                "id":       job_id,
                "source":   "한국철도공사",
                "title":    title,
                "org":      "한국철도공사",
                "deadline": deadline,
                "url":      full_url,
            })
        print(f"  코레일: {len(jobs)}건 수집")
    except Exception as e:
        print(f"  코레일 오류: {e}")
    return jobs

# ═══════════════════════════════════════════
# HTML 이메일 리포트 생성
# ═══════════════════════════════════════════
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

def build_html_report(matched: list[dict], today: str, title_prefix: str = "채용") -> str:
    total = len(matched)
    urgent = [j for j in matched if (j.get("days_left") or 99) <= URGENT_DAYS]

    urgent_html = ""
    if urgent:
        rows = ""
        for j in urgent:
            rows += (
                f"<tr style='background:#fff5f5;'>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;"
                f"font-weight:700;color:#dc2626;'>⚡ D-{j['days_left']}</td>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;'>"
                f"<a href='{j['url']}' style='color:#dc2626;font-weight:700;"
                f"text-decoration:none;'>{j['title']}</a></td>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;"
                f"font-size:12px;'>{j['org']}</td>"
                f"<td style='padding:7px 10px;border:1px solid #fca5a5;"
                f"text-align:center;'>{_grade_badge(j['grade'])}</td>"
                f"</tr>"
            )
        urgent_html = f"""
<h3 style='color:#dc2626;margin:16px 0 8px;font-size:14px;'>
  ⚡ 마감 임박 {URGENT_DAYS}일 이내 ({len(urgent)}건)
</h3>
<table width='100%' style='border-collapse:collapse;font-size:13px;margin-bottom:14px;'>
  <tr style='background:#7f1d1d;color:#fff;'>
    <th style='padding:7px 10px;text-align:left;width:70px;'>마감</th>
    <th style='padding:7px 10px;text-align:left;'>공고명</th>
    <th style='padding:7px 10px;text-align:left;width:120px;'>기관</th>
    <th style='padding:7px 10px;text-align:center;width:50px;'>매칭</th>
  </tr>
  {rows}
</table>"""

    if not matched:
        main_html = "<p style='color:#666;padding:10px 0;'>오늘 새로운 매칭 공고가 없습니다.</p>"
    else:
        rows = ""
        for j in matched:
            d = j.get("days_left")
            if d is None:
                dl_str = j.get("deadline") or "미정"
                dl_color = "#374151"
            elif d < 0:
                dl_str = "마감"
                dl_color = "#9ca3af"
            elif d <= URGENT_DAYS:
                dl_str = f"D-{d}"
                dl_color = "#dc2626"
            else:
                dl_str = f"D-{d}"
                dl_color = "#374151"
            rows += (
                f"<tr>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;"
                f"text-align:center;'>{_grade_badge(j['grade'])}</td>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;'>"
                f"<a href='{j['url']}' style='color:#1a3a6b;text-decoration:none;"
                f"font-weight:600;'>{j['title']}</a></td>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;"
                f"font-size:12px;'>{j['org']}</td>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;"
                f"font-size:11px;color:#6b7280;'>{j['source']}</td>"
                f"<td style='padding:8px 10px;border:1px solid #e8edf3;"
                f"font-size:12px;font-weight:{'700' if (d or 99)<=URGENT_DAYS else '400'};"
                f"color:{dl_color};'>{dl_str}</td>"
                f"</tr>"
            )
        main_html = f"""
<table width='100%' style='border-collapse:collapse;font-size:13px;'>
  <tr style='background:#1a3a6b;color:#fff;'>
    <th style='padding:8px 10px;text-align:center;width:50px;'>매칭</th>
    <th style='padding:8px 10px;text-align:left;'>공고명</th>
    <th style='padding:8px 10px;text-align:left;width:130px;'>기관</th>
    <th style='padding:8px 10px;text-align:left;width:90px;'>출처</th>
    <th style='padding:8px 10px;text-align:left;width:60px;'>마감</th>
  </tr>
  {rows}
</table>"""

    action_html = ""
    if matched:
        top3 = matched[:3]
        items_html = "".join(
            f"<li style='margin-bottom:5px;'>"
            f"<strong>{j['org']}</strong> — "
            f"<a href='{j['url']}' style='color:#1d4ed8;text-decoration:none;'>"
            f"{j['title'][:45]}{'…' if len(j['title'])>45 else ''}</a>"
            f" ({_grade_badge(j['grade'])})"
            f"</li>"
            for j in top3
        )
        action_html = f"""
<div style='background:#f0fdf4;border-left:4px solid #16a34a;padding:10px 14px;
            margin:14px 0 0;border-radius:0 6px 6px 0;'>
  <strong style='color:#15803d;font-size:13px;'>📋 오늘의 추천 액션</strong>
  <ol style='margin:8px 0 0 18px;font-size:13px;line-height:1.9;'>
    {items_html}
  </ol>
</div>"""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
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
      신규 매칭 공고 &nbsp;<strong style="color:#fff;font-size:16px;">{total}건</strong>
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
    {action_html}
  </div>

  <!-- 푸터 -->
  <div style="background:#f0f5fb;padding:11px 22px;font-size:11px;
              color:#9ca3af;border-top:1px solid #d0dcea;">
    자동 발송 · job_monitor.py · GitHub Actions
    &nbsp;|&nbsp; 수신거부: 워크플로우 비활성화
  </div>
</div>
</body>
</html>"""
    return html

# ═══════════════════════════════════════════
# 이메일 발송
# ═══════════════════════════════════════════
def send_email(html: str, subject: str,
               to_list: list[str], to_header: str,
               preview_filename: str = "report_preview.html"):
    if not GMAIL_USER or not GMAIL_PASSWORD:
        print(f"\n[이메일 미설정] 콘솔 미리보기: {subject}")
        out = Path(preview_filename)
        out.write_text(html, encoding="utf-8")
        print(f"  → {out} 저장됨")
        return
    if not to_list:
        print(f"  [건너뜀] 수신자 없음: {subject}")
        return

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
    except Exception as e:
        print(f"이메일 발송 실패: {e}", file=sys.stderr)

# ═══════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════
def main():
    now = datetime.now()
    today_str = now.strftime("%Y년 %m월 %d일 (%a)")
    print(f"{'='*50}")
    print(f"채용공고 모니터링 시작: {now.strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*50}")

    seen = load_seen()
    print(f"기존 확인 공고: {len(seen)}건\n")

    # ── 수집 ──
    print("【공고 수집】")
    tech_jobs: list[dict] = []
    tech_jobs += fetch_kric()
    tech_jobs += fetch_alio_api()
    tech_jobs += fetch_alio_web_tech()
    tech_jobs += fetch_korail()

    admin_jobs: list[dict] = []
    admin_jobs += fetch_alio_web_admin()

    all_jobs = tech_jobs + admin_jobs
    print(f"\n총 수집: {len(all_jobs)}건 (전산/통신 {len(tech_jobs)}건 + 행정 {len(admin_jobs)}건)")

    # ── 신규 필터링 ──
    new_tech  = [j for j in tech_jobs  if j["id"] not in seen]
    new_admin = [j for j in admin_jobs if j["id"] not in seen]
    print(f"신규: 전산/통신 {len(new_tech)}건, 행정 {len(new_admin)}건")

    # ── 본인 매칭 (전산/통신직) ──
    matched_tech = []
    for j in new_tech:
        s = score_job(j["title"], j["org"])
        if s >= MIN_SCORE:
            j["score"]     = s
            j["grade"]     = grade(s)
            j["days_left"] = days_left(j.get("deadline", ""))
            matched_tech.append(j)
    matched_tech.sort(key=lambda j: (-j["score"], j.get("days_left") or 999))
    print(f"매칭 (본인): {len(matched_tech)}건")

    # ── 동료 매칭 (행정직) ──
    matched_admin = []
    for j in new_admin:
        s = score_admin(j["title"], j["org"])
        if s >= MIN_ADMIN_SCORE:
            j["score"]     = s
            j["grade"]     = grade(s)
            j["days_left"] = days_left(j.get("deadline", ""))
            matched_admin.append(j)
    matched_admin.sort(key=lambda j: (-j["score"], j.get("days_left") or 999))
    print(f"매칭 (동료): {len(matched_admin)}건\n")

    # ── seen 갱신 ──
    seen.update(j["id"] for j in new_tech)
    seen.update(j["id"] for j in new_admin)
    save_seen(seen)
    print(f"seen_ids.json 업데이트: 총 {len(seen)}건")

    # ── 본인 이메일 발송 ──
    html_tech = build_html_report(matched_tech, today_str, "전산·통신직 채용 모니터링")
    subject_tech = f"[채용] {now.strftime('%m/%d')} 전산/통신 신규 {len(matched_tech)}건" + (
        f" ⚡D-{URGENT_DAYS}↓ {sum(1 for j in matched_tech if (j.get('days_left') or 99) <= URGENT_DAYS)}건"
        if any((j.get("days_left") or 99) <= URGENT_DAYS for j in matched_tech)
        else ""
    )
    send_email(html_tech, subject_tech,
               EMAIL_TO_LIST, EMAIL_TO,
               preview_filename="report_preview_tech.html")

    # ── 동료 이메일 발송 ──
    if EMAIL_TO_ADMIN_LIST:
        html_admin = build_html_report(matched_admin, today_str, "행정직(계약·예산·회계·재무) 채용 모니터링")
        subject_admin = f"[채용] {now.strftime('%m/%d')} 행정직 신규 {len(matched_admin)}건" + (
            f" ⚡D-{URGENT_DAYS}↓ {sum(1 for j in matched_admin if (j.get('days_left') or 99) <= URGENT_DAYS)}건"
            if any((j.get("days_left") or 99) <= URGENT_DAYS for j in matched_admin)
            else ""
        )
        send_email(html_admin, subject_admin,
                   EMAIL_TO_ADMIN_LIST, EMAIL_TO_ADMIN,
                   preview_filename="report_preview_admin.html")
    else:
        print("  동료 이메일 미설정 (EMAIL_TO_ADMIN 없음) — 행정직 리포트 건너뜀")

    print("\n완료.")

if __name__ == "__main__":
    main()
