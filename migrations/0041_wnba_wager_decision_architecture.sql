-- 0041_wnba_wager_decision_architecture.sql
-- Append-only point-in-time WNBA game wagering decisions and outcomes.
CREATE TABLE IF NOT EXISTS wnba_wager_decisions (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  decision_version TEXT NOT NULL,
  model_as_of TEXT,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL,
  american_price REAL NOT NULL,
  sportsbook TEXT,
  market_observed_at TEXT,
  model_probability REAL,
  break_even_probability REAL,
  probability_edge REAL,
  expected_value REAL,
  raw_confidence INTEGER,
  confidence INTEGER,
  confidence_calibration_state TEXT,
  confidence_calibration_n INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  stake_units REAL,
  stake_state TEXT,
  projection_json TEXT NOT NULL,
  factors_json TEXT,
  market_intelligence_json TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wnba_wager_decisions_event_time
  ON wnba_wager_decisions(event_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_wager_decisions_market_conf
  ON wnba_wager_decisions(market, confidence, captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_wager_decisions_decision
  ON wnba_wager_decisions(decision, captured_at);

CREATE TABLE IF NOT EXISTS wnba_wager_results (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  actual_home REAL,
  actual_away REAL,
  actual_margin REAL,
  actual_total REAL,
  result TEXT NOT NULL,
  win INTEGER,
  push INTEGER NOT NULL DEFAULT 0,
  close_line REAL,
  close_price REAL,
  clv_line REAL,
  clv_price REAL,
  settled_at TEXT NOT NULL,
  provenance_json TEXT,
  FOREIGN KEY(decision_id) REFERENCES wnba_wager_decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_wnba_wager_results_event
  ON wnba_wager_results(event_id, settled_at);

CREATE VIEW IF NOT EXISTS wnba_wager_confidence_calibration AS
SELECT
  d.market,
  d.side,
  CAST(d.confidence / 10 AS INTEGER) * 10 AS confidence_band,
  COUNT(*) AS graded,
  SUM(CASE WHEN r.push=0 THEN 1 ELSE 0 END) AS decisions,
  SUM(CASE WHEN r.win=1 THEN 1 ELSE 0 END) AS wins,
  CASE WHEN SUM(CASE WHEN r.push=0 THEN 1 ELSE 0 END)>0
    THEN 1.0*SUM(CASE WHEN r.win=1 THEN 1 ELSE 0 END)/
         SUM(CASE WHEN r.push=0 THEN 1 ELSE 0 END)
    ELSE NULL END AS hit_rate,
  AVG(d.expected_value) AS avg_expected_value,
  AVG(CASE WHEN r.push=0 THEN
    CASE WHEN r.win=1 THEN
      CASE WHEN d.american_price>0 THEN d.american_price/100.0 ELSE 100.0/ABS(d.american_price) END
    ELSE -1 END
  END) AS units_per_decision,
  AVG(r.clv_line) AS avg_clv_line,
  AVG(r.clv_price) AS avg_clv_price
FROM wnba_wager_decisions d
JOIN wnba_wager_results r ON r.decision_id=d.id
WHERE d.decision='BET'
GROUP BY d.market,d.side,CAST(d.confidence / 10 AS INTEGER) * 10;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0041_wnba_wager_decision_architecture',datetime('now'));
