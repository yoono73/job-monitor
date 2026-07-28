-- ============================================================
-- 당첨현황 기능 마이그레이션 (v1.5)
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query
-- 작성일: 2026-06-18
-- 순서대로 실행: Step 1 → Step 2 → Step 3
-- 롤백 필요 시: 20260618_001_ranking_rollback.sql 실행
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- Step 1: saved_numbers 컬럼 3개 추가
-- 왜: 추첨 결과를 서버에서 판정·저장해 집계에 활용
--     IF NOT EXISTS — 이미 추가된 경우 에러 없이 넘어감
-- ────────────────────────────────────────────────────────────
ALTER TABLE saved_numbers
  ADD COLUMN IF NOT EXISTS matched_count   INTEGER,  -- 당첨 번호 일치 개수 (0~6)
  ADD COLUMN IF NOT EXISTS prize_rank      INTEGER,  -- 등수 (1~5, NULL = 낙첨)
  ADD COLUMN IF NOT EXISTS checked_draw_no INTEGER;  -- 판정 완료 회차 (멱등 체크용)


-- ────────────────────────────────────────────────────────────
-- Step 2: 익명 집계 뷰 public_draw_stats
-- 왜: 개인 RLS(사용자 본인만 조회)는 유지하면서
--     뷰 소유자(postgres) 권한으로 전체 집계를 읽어
--     등수별 인원수 + 사용 전략을 익명으로 노출
--     → RLS 정책 재설계 불필요
-- 조건: purchased = true AND checked_draw_no IS NOT NULL
--       (구매 확정 + 판정 완료된 행만 집계)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public_draw_stats AS
SELECT
  s.draw_no,
  d.draw_date,
  d.n1, d.n2, d.n3, d.n4, d.n5, d.n6, d.bonus,
  COUNT(s.id)                                             AS total_entries,
  COUNT(CASE WHEN s.prize_rank = 1 THEN 1 END)           AS rank1_count,
  COUNT(CASE WHEN s.prize_rank = 2 THEN 1 END)           AS rank2_count,
  COUNT(CASE WHEN s.prize_rank = 3 THEN 1 END)           AS rank3_count,
  COUNT(CASE WHEN s.prize_rank = 4 THEN 1 END)           AS rank4_count,
  COUNT(CASE WHEN s.prize_rank = 5 THEN 1 END)           AS rank5_count,
  COUNT(CASE WHEN s.prize_rank IS NOT NULL THEN 1 END)   AS total_winners,
  -- 당첨자가 사용한 전략 목록 (익명, method:category 형태, 중복 제거)
  ARRAY_AGG(DISTINCT s.method || ':' || s.category
    ORDER BY s.method || ':' || s.category)
    FILTER (WHERE s.prize_rank IS NOT NULL)              AS winner_strategies
FROM saved_numbers s
LEFT JOIN lotto_draws d ON s.draw_no = d.draw_no
WHERE s.purchased = true
  AND s.checked_draw_no IS NOT NULL
GROUP BY
  s.draw_no, d.draw_date,
  d.n1, d.n2, d.n3, d.n4, d.n5, d.n6, d.bonus
ORDER BY s.draw_no DESC;

-- 익명 사용자 + 로그인 사용자 모두 조회 가능하게 권한 부여
GRANT SELECT ON public_draw_stats TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- Step 3: 판정 함수 judge_draw_results(p_draw_no)
-- 왜: 추첨 번호 업데이트 후 이 함수를 호출하면
--     해당 회차의 '미판정 행'만 골라 등수를 계산·저장
-- 멱등 보장: checked_draw_no = p_draw_no 인 행은 재처리 안 함
-- 사용법: SELECT * FROM judge_draw_results(1234);
-- 반환:   updated_count, rank1~rank5 카운트
-- SECURITY DEFINER: postgres 권한으로 실행 → RLS bypass
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION judge_draw_results(p_draw_no INTEGER)
RETURNS TABLE(
  updated_count  INTEGER,
  rank1          INTEGER,
  rank2          INTEGER,
  rank3          INTEGER,
  rank4          INTEGER,
  rank5          INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_win    INTEGER[];  -- 당첨 번호 6개 배열
  v_bonus  INTEGER;    -- 보너스 번호
  v_row    RECORD;
  v_match  INTEGER;
  v_rank   INTEGER;
  v_updated INTEGER := 0;
  v_r1 INTEGER := 0;
  v_r2 INTEGER := 0;
  v_r3 INTEGER := 0;
  v_r4 INTEGER := 0;
  v_r5 INTEGER := 0;
BEGIN
  -- 1. 해당 회차 당첨 번호 조회
  SELECT ARRAY[n1, n2, n3, n4, n5, n6], bonus
    INTO v_win, v_bonus
    FROM lotto_draws
   WHERE draw_no = p_draw_no;

  IF v_win IS NULL THEN
    RAISE EXCEPTION '회차 % 데이터가 lotto_draws에 없습니다. 추첨 번호 먼저 업데이트하세요.', p_draw_no;
  END IF;

  -- 2. 미판정 행만 순회 (멱등: checked_draw_no != p_draw_no 인 행만)
  FOR v_row IN
    SELECT id, numbers
      FROM saved_numbers
     WHERE draw_no          = p_draw_no
       AND purchased        = true
       AND (checked_draw_no IS NULL OR checked_draw_no != p_draw_no)
  LOOP
    -- 3. 일치 개수 계산 (numbers 배열 vs 당첨 번호 배열)
    SELECT COUNT(*)::INTEGER INTO v_match
      FROM unnest(v_row.numbers::INTEGER[]) AS n
     WHERE n = ANY(v_win);

    -- 4. 등수 판정 (로또 공식 기준)
    v_rank := CASE
      WHEN v_match = 6                                                        THEN 1  -- 1등: 6개 일치
      WHEN v_match = 5 AND v_bonus = ANY(v_row.numbers::INTEGER[])           THEN 2  -- 2등: 5개 + 보너스
      WHEN v_match = 5                                                        THEN 3  -- 3등: 5개
      WHEN v_match = 4                                                        THEN 4  -- 4등: 4개
      WHEN v_match = 3                                                        THEN 5  -- 5등: 3개
      ELSE NULL                                                                      -- 낙첨
    END;

    -- 5. 저장
    UPDATE saved_numbers
       SET matched_count   = v_match,
           prize_rank      = v_rank,
           checked_draw_no = p_draw_no
     WHERE id = v_row.id;

    v_updated := v_updated + 1;

    -- 6. 등수별 카운터
    CASE v_rank
      WHEN 1 THEN v_r1 := v_r1 + 1;
      WHEN 2 THEN v_r2 := v_r2 + 1;
      WHEN 3 THEN v_r3 := v_r3 + 1;
      WHEN 4 THEN v_r4 := v_r4 + 1;
      WHEN 5 THEN v_r5 := v_r5 + 1;
      ELSE NULL;
    END CASE;
  END LOOP;

  RETURN QUERY SELECT v_updated, v_r1, v_r2, v_r3, v_r4, v_r5;
END;
$$;

-- 로그인 사용자만 호출 가능 (서버 스케줄러 / 관리자)
-- anon에는 부여하지 않음
GRANT EXECUTE ON FUNCTION judge_draw_results(INTEGER) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 실행 확인 쿼리 (선택사항 — 실행 후 결과 검증용)
-- ────────────────────────────────────────────────────────────
-- 컬럼 추가 확인:
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'saved_numbers'
--    AND column_name IN ('matched_count','prize_rank','checked_draw_no');
--
-- 뷰 확인:
-- SELECT * FROM public_draw_stats LIMIT 5;
--
-- 함수 테스트 (실제 draw_no로 교체):
-- SELECT * FROM judge_draw_results(1234);
