-- Generic append-only normalized market observation ledger.
-- Market data is observational. It never grants qualification or wager authority.
CREATE TABLE IF NOT EXISTS normalized_market_observations (
  id TEXT PRIMARY KEY,
  observation_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  sport TEXT NOT NULL,
  league TEXT,
  canonical_event_id TEXT,
  provider_event_id TEXT,
  event_start_time TEXT,
  home_team TEXT,
  away_team TEXT,
  canonical_player_id TEXT,
  provider_player_id TEXT,
  player_name TEXT,
  team TEXT,
  opponent TEXT,
  market_family TEXT NOT NULL,
  stat_family TEXT,
  side TEXT,
  line REAL,
  american_odds REAL,
  decimal_odds REAL,
  contract_price REAL,
  payout_multiplier REAL,
  standard_or_alt TEXT,
  promo INTEGER,
  period TEXT,
  source_market_id TEXT,
  source_outcome_id TEXT,
  source_observed_at TEXT,
  collected_at TEXT NOT NULL,
  snapshot_type TEXT NOT NULL DEFAULT 'CURRENT',
  model_id TEXT,
  model_version TEXT,
  model_probability REAL,
  fair_american_price REAL,
  raw_implied_probability REAL,
  no_vig_market_probability REAL,
  probability_edge REAL,
  expected_return_per_unit_risk REAL,
  execution_eligible INTEGER,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  result_value REAL,
  result_side TEXT,
  settled_at TEXT,
  raw_payload_json TEXT,
  raw_payload_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_norm_market_event_time ON normalized_market_observations(sport,canonical_event_id,collected_at);
CREATE INDEX IF NOT EXISTS idx_norm_market_player ON normalized_market_observations(sport,canonical_player_id,stat_family,collected_at);
CREATE INDEX IF NOT EXISTS idx_norm_market_source ON normalized_market_observations(source,sport,market_family,collected_at);
CREATE INDEX IF NOT EXISTS idx_norm_market_snapshot ON normalized_market_observations(snapshot_type,sport,collected_at);

CREATE TABLE IF NOT EXISTS normalized_market_decision_links (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  decision_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(decision_id,observation_id,role),
  FOREIGN KEY(observation_id) REFERENCES normalized_market_observations(id)
);
CREATE INDEX IF NOT EXISTS idx_norm_market_decision ON normalized_market_decision_links(decision_id,role);

CREATE TABLE IF NOT EXISTS normalized_market_economic_grades (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  entry_observation_id TEXT NOT NULL,
  close_observation_id TEXT,
  sport TEXT NOT NULL,
  canonical_event_id TEXT,
  canonical_player_id TEXT,
  market_family TEXT NOT NULL,
  stat_family TEXT,
  source TEXT NOT NULL,
  side TEXT,
  entry_line REAL,
  entry_american_odds REAL,
  entry_model_probability REAL,
  close_line REAL,
  close_american_odds REAL,
  close_no_vig_probability REAL,
  clv_probability_points REAL,
  result_value REAL,
  won INTEGER,
  profit_units REAL,
  graded_at TEXT,
  metric_method_version TEXT NOT NULL DEFAULT 'FBIS-MARKET-ECON-v1',
  created_at TEXT NOT NULL,
  UNIQUE(decision_id,entry_observation_id)
);
CREATE INDEX IF NOT EXISTS idx_norm_market_grade_source ON normalized_market_economic_grades(sport,source,market_family,graded_at);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0095_normalized_market_observation_ledger',datetime('now'));
