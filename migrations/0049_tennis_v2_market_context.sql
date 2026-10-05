-- Tennis v2 market/context research state.
-- Immutable snapshots; no wager authorization.

CREATE TABLE IF NOT EXISTS tennis_market_snapshots (
  id TEXT PRIMARY KEY,
  canonical_event_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'moneyline',
  provider TEXT NOT NULL,
  sportsbook TEXT,
  player1_price REAL,
  player2_price REAL,
  player1_no_vig_prob REAL,
  player2_no_vig_prob REAL,
  hold REAL,
  observed_at TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  snapshot_type TEXT,
  traded_volume REAL,
  public_ticket_pct REAL,
  public_money_pct REAL,
  money_minus_ticket_pct REAL,
  line_velocity REAL,
  raw_payload_hash TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_market_event_time
  ON tennis_market_snapshots(canonical_event_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_tennis_market_provider
  ON tennis_market_snapshots(provider, tour, observed_at);

CREATE TABLE IF NOT EXISTS tennis_context_snapshots (
  id TEXT PRIMARY KEY,
  canonical_event_id TEXT NOT NULL,
  canonical_player_id TEXT,
  player_name TEXT NOT NULL,
  tour TEXT NOT NULL,
  tournament TEXT,
  surface TEXT,
  indoor INTEGER,
  altitude_m REAL,
  court_speed_index REAL,
  hours_since_last_match REAL,
  minutes_last_3_days REAL,
  minutes_last_7_days REAL,
  travel_km_7_days REAL,
  time_zones_crossed_7_days REAL,
  injury_status TEXT,
  days_since_injury_return REAL,
  days_since_retirement_or_mto REAL,
  recent_serve_speed_delta_kph REAL,
  serve_style_score REAL,
  return_style_score REAL,
  source TEXT NOT NULL,
  source_as_of TEXT,
  collected_at TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_context_event_player
  ON tennis_context_snapshots(canonical_event_id, player_name, feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS tennis_v2_research_decisions (
  id TEXT PRIMARY KEY,
  canonical_event_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  pure_model_id TEXT NOT NULL,
  market_model_id TEXT,
  pure_p1 REAL,
  market_prior_p1 REAL,
  market_v2_p1 REAL,
  market_residual REAL,
  model_edge REAL,
  context_json TEXT,
  action_json TEXT,
  market_json TEXT,
  decision_timestamp TEXT NOT NULL,
  event_start_time TEXT,
  snapshot_type TEXT NOT NULL,
  result_winner TEXT,
  closing_p1_no_vig REAL,
  clv REAL,
  profit_units REAL,
  graded_at TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_v2_decisions_event
  ON tennis_v2_research_decisions(canonical_event_id, decision_timestamp);
CREATE INDEX IF NOT EXISTS idx_tennis_v2_decisions_grade
  ON tennis_v2_research_decisions(graded_at, tour);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0049_tennis_v2_market_context', datetime('now'));
