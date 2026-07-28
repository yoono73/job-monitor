-- ============================================================
-- 당첨현황 기능 롤백
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query
-- 작성일: 2026-06-18
-- ⚠️  Step 1 롤백 시 matched_count·prize_rank·checked_draw_no
--     컬럼 데이터가 영구 삭제됩니다. 신중하게 실행하세요.
-- ============================================================


-- Step 3 롤백: 판정 함수 삭제
DROP FUNCTION IF EXISTS judge_draw_results(INTEGER);

-- Step 2 롤백: 집계 뷰 삭제
DROP VIEW IF EXISTS public_draw_stats;

-- Step 1 롤백: 컬럼 삭제 (데이터 손실 발생)
-- ⚠️  실행 전 백업 권장:
--     SELECT * FROM saved_numbers WHERE matched_count IS NOT NULL;
ALTER TABLE saved_numbers
  DROP COLUMN IF EXISTS matched_count,
  DROP COLUMN IF EXISTS prize_rank,
  DROP COLUMN IF EXISTS checked_draw_no;
