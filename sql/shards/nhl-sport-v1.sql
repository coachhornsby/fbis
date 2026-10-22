-- FBIS NHL_DB sport working-set pilot.
-- Primary remains authority until NHL_SPORT_DB_MODE=sport after parity passes.
-- Do not store unbounded WebSocket ticks here.

CREATE TABLE IF NOT EXISTS fbis_sport_shard_meta (
  key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO fbis_sport_shard_meta(key, value_text) VALUES
 ('sport','nhl'),
 ('binding','NHL_DB'),
 ('pilot_status','SCHEMA_READY'),
 ('contract','fbis-sport-d1-v1');

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  start TEXT,
  status TEXT,
  home_name TEXT,
  away_name TEXT,
  home_abbr TEXT,
  away_abbr TEXT,
  home_id TEXT,
  away_id TEXT,
  season TEXT,
  week INTEGER,
  venue TEXT,
  payload_json TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nhl_games_start ON games(start);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_version TEXT,
  projection_kind TEXT,
  proj_total REAL,
  proj_home REAL,
  proj_away REAL,
  p_home_final REAL,
  frozen_at TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nhl_pred_game ON prediction_snapshots(game_id, frozen_at);

CREATE TABLE IF NOT EXISTS published_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  published_at TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nhl_pub_game ON published_projections(game_id, published_at);

-- Canonical NHL-only wager research/settlement schema.
-- The original four-column pilot placeholders were retired in production 2026-10-22.
-- Store only NHL research rows in NHL_DB; never promote betting authority by schema.
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
  research_candidate INTEGER NOT NULL DEFAULT 0,
  suggested_units REAL NOT NULL DEFAULT 0,
  model_id TEXT,
  model_version TEXT,
  projection_json TEXT,
  disagreement_json TEXT,
  trajectory_json TEXT,
  source_snapshot_type TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  game_type INTEGER
);

CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_event
  ON nhl_wager_decisions(event_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_game_type ON nhl_wager_decisions(game_type,wager_scope,snapshot_at);
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
WHERE d.research_candidate=1
GROUP BY d.wager_scope,d.market,confidence_band;


CREATE TABLE IF NOT EXISTS nhl_goalie_probability_shadow (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  frozen_at TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS nhl_bookmaker_quote_evidence (
  id TEXT PRIMARY KEY,
  source_event_id TEXT,
  captured_at TEXT,
  bookmaker TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS nhl_parity_receipts (
  receipt_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  table_name TEXT NOT NULL,
  primary_count INTEGER,
  sport_count INTEGER,
  matched INTEGER,
  status TEXT NOT NULL,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS fbis_topology_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

INSERT OR IGNORE INTO fbis_topology_migrations(migration_id, notes)
VALUES ('nhl-sport-v1', 'NHL sport D1 pilot schema');

-- Mirror the source NHL research uniqueness contracts. A plain PK-only
-- shadow copy permitted duplicate events, line pairs and schedule games.
-- Production NHL_DB was verified duplicate-free before these were added.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nhl_goalie_shadow_event_model
  ON nhl_goalie_probability_shadow(event_id,model_version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nhl_linemates_team_pair_strength
  ON nhl_linemate_profiles(team_key,player_id,teammate_id,strength_state);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nhl_schedule_season_team_game
  ON nhl_team_schedule_profile(season_id,team_key,game_id);
