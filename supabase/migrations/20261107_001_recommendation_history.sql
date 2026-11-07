-- 추천 이력 테이블
CREATE TABLE IF NOT EXISTS recommendation_history (
  id BIGSERIAL PRIMARY KEY,
  draw_no INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  numbers INTEGER[] NOT NULL,
  prize_rank INTEGER,
  prize_amount INTEGER DEFAULT 0,
  matched_count INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rh_draw_no ON recommendation_history(draw_no DESC);
CREATE INDEX IF NOT EXISTS idx_rh_strategy ON recommendation_history(strategy);

COMMENT ON TABLE recommendation_history IS '로또 추천 이력 및 당첨 결과';
COMMENT ON COLUMN recommendation_history.strategy IS '분산추천|황금구간|번호쌍|베이지안 등';
COMMENT ON COLUMN recommendation_history.prize_rank IS '1~5등, NULL=미당첨';
