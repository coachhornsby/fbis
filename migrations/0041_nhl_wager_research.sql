-- 0041_nhl_wager_research.sql
-- Immutable NHL game/prop wager-decision evidence and post-event settlement.
-- Decisions are research-only until walk-forward ROI/calibration/CLV/drawdown/
-- confidence-monotonicity governance clears authority.

CREATE TABLE IF NOT EXISTS nhl_wager_decisions (
  id TEXT PRIMARY KEY,
  snapshot_at TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_start TEXT,
  wager_scope TEXT NOT NULL, -- GAME | PROP
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL,
  american_price REAL,
  model_probability REAL,
  calibrated_probability REAL,
  break_even_probability REAL,
  market_no_vig_probability REAL,
  probability_edge REAL,
  expected_roi REAL,
  reliability REAL,
  confidence INTEGER,
  confidence_version TEXT,
  confidence_status TEXT,
  decision TEXT NOT NULL,
  suggested_units REAL NOT NULL DEFAULT 0,
  model_id TEXT,
  model_version TEXT,
  projection_json TEXT,
  disagreement_json TEXT,
  trajectory_json TEXT,
  source_snapshot_type TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_event
  ON nhl_wager_decisions(event_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_market
  ON nhl_wager_decisions(wager_scope, market, selection, confidence, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_research_bet
  ON nhl_wager_decisions(decision, snapshot_at);

CREATE TABLE IF NOT EXISTS nhl_wager_settlements (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  actual_home REAL,
  actual_away REAL,
  actual_player_value REAL,
  result TEXT NOT NULL, -- WIN | LOSS | PUSH | VOID
  risk_units REAL NOT NULL DEFAULT 1,
  profit_units REAL NOT NULL DEFAULT 0,
  close_line REAL,
  close_price REAL,
  close_no_vig_probability REAL,
  clv_probability_pp REAL,
  notes TEXT,
  FOREIGN KEY(decision_id) REFERENCES nhl_wager_decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_nhl_wager_settlements_event
  ON nhl_wager_settlements(event_id, settled_at);

CREATE VIEW IF NOT EXISTS nhl_wager_confidence_calibration AS
SELECT
  d.wager_scope,
  d.market,
  CASE
    WHEN d.confidence < 50 THEN '0-49'
    WHEN d.confidence < 60 THEN '50-59'
    WHEN d.confidence < 70 THEN '60-69'
    WHEN d.confidence < 80 THEN '70-79'
    WHEN d.confidence < 90 THEN '80-89'
    ELSE '90-100'
  END AS confidence_band,
  COUNT(*) AS graded,
  SUM(CASE WHEN s.result='WIN' THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN s.result='LOSS' THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN s.result='PUSH' THEN 1 ELSE 0 END) AS pushes,
  SUM(s.profit_units) AS units,
  CASE WHEN SUM(ABS(s.risk_units)) > 0
    THEN SUM(s.profit_units) / SUM(ABS(s.risk_units)) ELSE NULL END AS roi,
  AVG(d.calibrated_probability) AS mean_probability,
  AVG(CASE WHEN s.result='WIN' THEN 1.0 WHEN s.result='LOSS' THEN 0.0 END) AS win_rate,
  AVG(s.clv_probability_pp) AS avg_clv_probability_pp
FROM nhl_wager_decisions d
JOIN nhl_wager_settlements s ON s.decision_id=d.id
WHERE d.decision='BET'
GROUP BY d.wager_scope,d.market,confidence_band;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0041_nhl_wager_research', datetime('now'));
