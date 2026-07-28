-- ============================================================
-- saved_numbers 테이블 RLS 마이그레이션
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query
-- 작성일: 2026-06-17
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Step 1: user_id 컬럼 추가 (이미 있으면 SKIP)
-- ────────────────────────────────────────────────────────────
ALTER TABLE saved_numbers
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ────────────────────────────────────────────────────────────
-- Step 2: RLS(Row Level Security) 활성화
-- ────────────────────────────────────────────────────────────
ALTER TABLE saved_numbers ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- Step 3: 기존 정책 정리 (중복 방지)
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "own_select" ON saved_numbers;
DROP POLICY IF EXISTS "own_insert" ON saved_numbers;
DROP POLICY IF EXISTS "own_update" ON saved_numbers;
DROP POLICY IF EXISTS "own_delete" ON saved_numbers;

-- ────────────────────────────────────────────────────────────
-- Step 4: 정책 생성 (내 데이터만 접근 가능)
-- ────────────────────────────────────────────────────────────
CREATE POLICY "own_select"
  ON saved_numbers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own_insert"
  ON saved_numbers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_update"
  ON saved_numbers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "own_delete"
  ON saved_numbers FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- Step 5: 고아 데이터 삭제 (user_id 없는 테스트 데이터)
-- ────────────────────────────────────────────────────────────
-- ⚠️ 실행 전 확인하고 싶으면 먼저 아래 SELECT 로 개수 확인:
-- SELECT count(*) FROM saved_numbers WHERE user_id IS NULL;
DELETE FROM saved_numbers
  WHERE user_id IS NULL;

-- ────────────────────────────────────────────────────────────
-- 완료 확인 쿼리 (선택사항)
-- ────────────────────────────────────────────────────────────
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE tablename = 'saved_numbers';
--
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'saved_numbers';
