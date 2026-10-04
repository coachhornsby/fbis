-- NFL game-level wager decision ledger.
-- Append-only point-in-time evaluations. Closing data is evaluation-only and
-- must never overwrite or mutate the original pregame decision row.

CREATE TABLE IF NOT EXISTS nfl_wager_decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'nfl',
  evaluated_at TEXT NOT NULL,
  model_id TEXT,
  model_version TEXT,
  decision_version TEXT NOT NULL,
  market_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  sportsbook TEXT,
  offered_line REAL,
  american_price REAL,
  break_even_probability REAL,
  model_probability REAL,
  probability_edge REAL,
  expected_value_per_unit_risk REAL,
  uncertainty_sigma REAL,
  raw_confidence_score INTEGER,
  confidence_score INTEGER,
  confidence_validated INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  stake_units REAL,
  projection_json TEXT NOT NULL,
  decomposition_json TEXT,
  wager_intelligence_json TEXT,
  reasons_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nfl_wager_decisions_event_time
  ON nfl_wager_decisions(event_id, evaluated_at);

CREATE INDEX IF NOT EXISTS idx_nfl_wager_decisions_market
  ON nfl_wager_decisions(market_type, selection, evaluated_at);

CREATE TABLE IF NOT EXISTS nfl_wager_outcomes (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  result TEXT,
  units REAL,
  closing_line REAL,
  closing_price REAL,
  clv_line REAL,
  clv_price REAL,
  actual_margin REAL,
  actual_total REAL,
  evaluation_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(decision_id) REFERENCES nfl_wager_decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_nfl_wager_outcomes_event
  ON nfl_wager_outcomes(event_id, settled_at);


INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0041_nfl_wager_decisions', datetime('now'));
