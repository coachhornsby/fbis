-- 0040_wnba_prop_validation.sql
-- Durable WNBA PrizePicks projection/outcome ledger for empirical star calibration.
CREATE TABLE IF NOT EXISTS wnba_prop_validation (
  id TEXT PRIMARY KEY,
  source_line_id TEXT NOT NULL,
  run_id TEXT,
  event_id TEXT,
  game_start TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market TEXT NOT NULL,
  line REAL NOT NULL,
  odds_tier TEXT,
  fbis_projection REAL NOT NULL,
  fbis_sigma REAL,
  projection_delta REAL,
  candidate_side TEXT,
  raw_star INTEGER,
  actual REAL NOT NULL,
  result TEXT NOT NULL,
  hit INTEGER,
  push INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT,
  collected_at TEXT,
  graded_at TEXT NOT NULL,
  model_version TEXT,
  UNIQUE(source_line_id)
);

CREATE INDEX IF NOT EXISTS idx_wnba_prop_validation_market_star
  ON wnba_prop_validation(market, raw_star, candidate_side, odds_tier);
CREATE INDEX IF NOT EXISTS idx_wnba_prop_validation_player
  ON wnba_prop_validation(player_name, game_start DESC);

CREATE VIEW IF NOT EXISTS wnba_prop_calibration AS
SELECT
  market,
  raw_star,
  candidate_side,
  COALESCE(odds_tier,'standard') AS odds_tier,
  COUNT(*) AS graded,
  SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) AS decisions,
  SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) AS hits,
  CASE
    WHEN SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) > 0
    THEN 1.0 * SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) /
         SUM(CASE WHEN push=0 THEN 1 ELSE 0 END)
    ELSE NULL
  END AS hit_rate,
  AVG(ABS(projection_delta)) AS avg_abs_projection_delta,
  AVG(CASE WHEN fbis_sigma IS NOT NULL AND fbis_sigma > 0
           THEN ABS(projection_delta / fbis_sigma) END) AS avg_abs_z
FROM wnba_prop_validation
GROUP BY market, raw_star, candidate_side, COALESCE(odds_tier,'standard');

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0040_wnba_prop_validation', datetime('now'));
