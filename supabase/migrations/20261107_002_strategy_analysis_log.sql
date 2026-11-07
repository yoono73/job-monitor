-- ============================================================
-- 로또 전략 분석 로그 테이블
-- 매주 토요일 당첨 후 1~최신회 전체 분석 결과 및 전략 도출 기록
-- ============================================================

-- ① 주간 분석 결과 테이블
CREATE TABLE IF NOT EXISTS lotto_analysis_weekly (
  id              SERIAL PRIMARY KEY,
  week_no         INT NOT NULL,          -- 기준 회차 (최신 당첨회차)
  draw_date       DATE NOT NULL,         -- 해당 회차 날짜
  analyzed_at     TIMESTAMPTZ DEFAULT NOW(),

  -- 핵심 패턴 발견 (JSON)
  findings        JSONB NOT NULL DEFAULT '{}',
  -- 구조 예시:
  -- {
  --   "sum_dist":     { "peak": "121~130", "rate": 0.18 },
  --   "odd_even":     { "top": "3:3", "rate": 0.32 },
  --   "consecutive":  { "0pair": 0.44, "1pair": 0.42, "2pair": 0.14 },
  --   "zone":         { "top": "2-2-2", "rate": 0.15 },
  --   "tail_bias":    [1, 2, 7],
  --   "hot_recent50": [3, 7, 14, 22, 38, 42],
  --   "overdue_top5": [9, 18, 27, 33, 41]
  -- }

  notes           TEXT,
  created_by      TEXT DEFAULT 'system'
);

-- ② 전략 도출 로그 테이블
CREATE TABLE IF NOT EXISTS lotto_strategy_log (
  id              SERIAL PRIMARY KEY,
  analysis_id     INT REFERENCES lotto_analysis_weekly(id),
  week_no         INT NOT NULL,          -- 도출 기준 회차
  draw_date       DATE NOT NULL,

  -- 전략 정보
  strategy_key    TEXT NOT NULL,         -- 코드 키 (예: "sum_band_120_130")
  strategy_name   TEXT NOT NULL,         -- 한글명 (예: "합계120~130집중")
  strategy_desc   TEXT NOT NULL,         -- 전략 설명
  category        TEXT NOT NULL,         -- 카테고리 (통계기반/패턴기반/균형기반/베이지안)
  icon            TEXT DEFAULT '🆕',

  -- 백테스트 결과
  backtest_period   INT,                 -- 백테스트 대상 회차 수
  backtest_hit_rate NUMERIC(5,2),        -- 3개 이상 적중률 (%)
  avg_match_count   NUMERIC(4,2),        -- 평균 일치 번호 수

  -- 채택 여부
  adopted         BOOLEAN DEFAULT FALSE,
  adopted_at      TIMESTAMPTZ,

  -- 근거
  basis_pattern   TEXT NOT NULL,         -- 발견 근거 한 줄 요약
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_analysis_weekly_week_no ON lotto_analysis_weekly(week_no);
CREATE INDEX IF NOT EXISTS idx_strategy_log_week_no    ON lotto_strategy_log(week_no);
CREATE INDEX IF NOT EXISTS idx_strategy_log_adopted    ON lotto_strategy_log(adopted);
