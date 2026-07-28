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
from datetime import datetime, date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from bs4 import BeautifulSoup


# ═══════════════════════════════════════════
# 환경변수 (GitHub Actions Secrets에서 주입)
# ═══════════════════════════════════════════
EMAIL_TO        = os.environ.get("EMAIL_TO",           "yoono73@gmail.com")
GMAIL_USER      = os.environ.get("GMAIL_USER",         "")   # 발신 Gmail 주소
GMAIL_PASSWORD  = os.environ.get("GMAIL_APP_PASSWORD", "")   # Gmail 앱 비밀번호
ALIO_API_KEY    = os.environ.get("ALIO_API_KEY",       "")   # data.go.kr API 키 (선택)

SEEN_IDS_FILE   = Path("seen_ids.json")


# ═══════════════════════════════════════════
# 매칭 설정 — 필요에 따라 수정하세요
# ═══════════════════════════════════════════
KEYWORDS = {
    # 고점수: 직무 핵심 키워드
    "AFC":        5,
    "자동요금":   5,
    "LTE-R":      5,
    "LTE_R":      4,
    "철도통신":   4,
    "통신직":     3,
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
    # 최우선 — 매일 확인
    "한국철도공사": 5,
    "코레일":       5,
    "국가철도공단": 5,
    "서울교통공사": 5,
    "인천교통공사": 4,
    "경기교통공사": 4,
    "수서고속철도": 3,
    "SR":           3,
    # 차순위
    "한국공항공사":     2,
    "인천국제공항":     2,
    "부산교통공사":     2,
    "대구교통공사":     2,
    "광주교통공사":     2,
    "대전교통공사":     2,
    "서울도시철도":     2,
    "한국도로공사":     1,
}

MIN_SCORE = 1   # 이 점수 이상만 리포트에 포함
URGENT_DAYS = 7 # D-7 이하는 마감임박 표시


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


def grade(score: int) -> str:
    if score >= 7:
        return "상"
    if score >= 3:
        return "중"
    return "하"


def days_left(deadline_str: str) -> int | None:
    """마감일 문자열 → 오늘 기준 남은 일수"""
    if not deadline_str:
        return None
    # 지원 형식: "2026.07.31", "2026-07-31", "20260731"
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
    """
    kric.go.kr — robots.txt 전면 허용, 서버사이드 JSP
    페이지당 10건, 1페이지만 수집 (최신 10건)
    """
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
            print("  kric: 테이블 미발견 — 사이트 구조 변경 가능성")
            return []

        tbody = table.find("tbody") or table
        for row in tbody.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 4:
                continue

            link_tag = cols[1].find("a") if len(cols) > 1 else None
            if not link_tag:
                continue

            # gotoDetail(숫자) 에서 ID 추출
            onclick = (
                link_tag.get("href", "") + " " + link_tag.get("onclick", "")
            )
            id_m = re.search(r"gotoDetail\((\d+)\)", onclick)
            if not id_m:
                continue

            board_seq = id_m.group(1)
            title    = link_tag.get_text(strip=True)
            org      = cols[2].get_text(strip=True) if len(cols) > 2 else ""
            deadline = cols[3].get_text(strip=True) if len(cols) > 3 else ""
            status   = cols[4].get_text(strip=True) if len(cols) > 4 else ""

            # 이미 마감된 공고 제외
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
    """
    공공데이터포털 Open API — ALIO_API_KEY 환경변수가 있을 때만 실행
    키 발급: https://www.data.go.kr/data/15125273/openapi.do
    """
    if not ALIO_API_KEY:
        print("  잡알리오 API: 키 미설정 (건너뜀)")
        return []

    jobs = []
    # 공공데이터포털 서비스 엔드포인트
    # ※ 키 발급 후 실제 operationName은 API 문서에서 확인하세요
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

        # 응답 구조: response.body.items.item (단건이면 dict, 다건이면 list)
        items = (
            data.get("response", {})
                .get("body", {})
                .get("items", {})
                .get("item", [])
        )
        if isinstance(items, dict):
            items = [items]

        for item in items:
            # 필드명은 실제 API 응답에 따라 조정 필요
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
# 크롤러 3: 한국철도공사 채용
# ═══════════════════════════════════════════
def fetch_korail() -> list[dict]:
    """
    info.korail.com — 공사 공식 채용 게시판
    """
    jobs = []
    url = "https://info.korail.com/info/selectBbsNttList.do?bbsNo=198&key=733"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")

        # 공고 행 탐색 (일반 table tbody tr 또는 ul li 구조)
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

            # nttNo 파라미터에서 ID 추출
            id_m = re.search(r"nttNo=(\d+)", href)
            job_id = f"korail_{id_m.group(1)}" if id_m else f"korail_{abs(hash(title))}"

            # 마감일 추출 (날짜 패턴이 있는 td)
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
# 크롤러 4: 잡코리아 (공공기관 키워드 검색)
# ═══════════════════════════════════════════
def fetch_jobkorea() -> list[dict]:
    """
    jobkorea.co.kr — robots.txt에서 /recruit/joblist 허용
    '정보통신 공공기관' 키워드로 검색
    """
    jobs = []
    url = "https://www.jobkorea.co.kr/recruit/joblist"
    params = {
        "menuCode": "duty",
        "duty_step1": "I201",   # 정보통신 직종 코드 (실제 코드 확인 필요)
        "keywordType": "all",
        "keyword": "정보통신 공공기관",
    }
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=20)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")

        # 공고 카드 탐색
        items = soup.select(".list-post .post-list-info, .recruit-info-list li")
        for item in items:
            link = item.find("a")
            if not link:
                continue

            title = link.get_text(strip=True)
            org_el = item.select_one(".name, .corp-name, .post-corp-name")
            org = org_el.get_text(strip=True) if org_el else ""

            href = link.get("href", "")
            full_url = (
                f"https://www.jobkorea.co.kr{href}"
                if href.startswith("/")
                else href
            )

            # Recruit/GI_Read/숫자 패턴
            id_m = re.search(r"GI_Read/(\d+)", full_url)
            job_id = f"jk_{id_m.group(1)}" if id_m else f"jk_{abs(hash(title))}"

            deadline_el = item.select_one(".date, .post-date")
            deadline = deadline_el.get_text(strip=True) if deadline_el else ""

            jobs.append({
                "id":       job_id,
                "source":   "잡코리아",
                "title":    title,
                "org":      org,
                "deadline": deadline,
                "url":      full_url,
            })

        print(f"  잡코리아: {len(jobs)}건 수집")
    except Exception as e:
        print(f"  잡코리아 오류: {e}")
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


def build_html_report(matched: list[dict], today: str) -> str:
    total = len(matched)
    urgent = [j for j in matched if (j.get("days_left") or 99) <= URGENT_DAYS]

    # ── 마감임박 섹션 ──
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

    # ── 전체 공고 목록 ──
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

    # ── 추천 액션 ──
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

    # ── 조립 ──
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
                margin-bottom:5px;">DAILY JOB REPORT · 채용공고 모니터링</div>
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
def send_email(html: str, subject: str):
    if not GMAIL_USER or not GMAIL_PASSWORD:
        print("\n[이메일 미설정] 콘솔 미리보기:")
        print(f"  제목: {subject}")
        print(f"  HTML: {len(html):,}자")
        # 로컬 테스트용: HTML 파일로 저장
        out = Path("report_preview.html")
        out.write_text(html, encoding="utf-8")
        print(f"  → {out} 저장됨 (브라우저로 열어 확인)")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = GMAIL_USER
    msg["To"]      = EMAIL_TO

    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_USER, GMAIL_PASSWORD)
            server.sendmail(GMAIL_USER, EMAIL_TO, msg.as_string())
        print(f"✉️  이메일 발송 완료 → {EMAIL_TO}")
    except Exception as e:
        print(f"이메일 발송 실패: {e}", file=sys.stderr)
        # 발송 실패해도 seen_ids는 저장됨 (재발송 방지)


# ═══════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════
def main():
    now = datetime.now()
    today_str = now.strftime("%Y년 %m월 %d일 (%a)")
    print(f"{'='*50}")
    print(f"채용공고 모니터링 시작: {now.strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*50}")

    # 1. 이미 확인한 공고 ID 로드
    seen = load_seen()
    print(f"기존 확인 공고: {len(seen)}건\n")

    # 2. 모든 소스에서 공고 수집
    print("【공고 수집】")
    all_jobs: list[dict] = []
    all_jobs += fetch_kric()
    all_jobs += fetch_alio_api()
    all_jobs += fetch_korail()
    # all_jobs += fetch_jobkorea()  # 필요 시 주석 해제
    print(f"\n총 수집: {len(all_jobs)}건")

    # 3. 신규 공고만 필터링
    new_jobs = [j for j in all_jobs if j["id"] not in seen]
    print(f"신규 공고: {len(new_jobs)}건")

    # 4. 매칭도 채점
    matched = []
    for j in new_jobs:
        s = score_job(j["title"], j["org"])
        if s >= MIN_SCORE:
            j["score"]     = s
            j["grade"]     = grade(s)
            j["days_left"] = days_left(j.get("deadline", ""))
            matched.append(j)

    # 매칭도 내림차순, 마감임박 우선
    matched.sort(key=lambda j: (-j["score"], j.get("days_left") or 999))
    print(f"매칭 공고: {len(matched)}건\n")

    # 5. 본 공고 ID 갱신 저장
    seen.update(j["id"] for j in new_jobs)
    save_seen(seen)
    print(f"seen_ids.json 업데이트: 총 {len(seen)}건")

    # 6. 리포트 생성 + 이메일 발송
    html    = build_html_report(matched, today_str)
    subject = f"[채용] {now.strftime('%m/%d')} 신규 {len(matched)}건" + (
        f" ⚡D-{URGENT_DAYS}↓ {sum(1 for j in matched if (j.get('days_left') or 99) <= URGENT_DAYS)}건"
        if any((j.get("days_left") or 99) <= URGENT_DAYS for j in matched)
        else ""
    )
    send_email(html, subject)

    print("\n완료.")


if __name__ == "__main__":
    main()
