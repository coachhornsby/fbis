-- Soccer Phase 3 persistent living-state research bank.
-- Research-only by construction: no row in these tables may influence production projection
-- or wager authority until a later leakage-safe ablation/promotion process explicitly changes policy.

CREATE TABLE IF NOT EXISTS soccer_team_state (
  team_id TEXT PRIMARY KEY,
  team_name TEXT,
  league_key TEXT,
  manager_name TEXT,
  primary_formation TEXT,
  goalkeeper_player_id TEXT,
  goalkeeper_name TEXT,
  latest_lineup_match_id TEXT,
  latest_lineup_observed_at TEXT,
  latest_lineup_confirmed INTEGER NOT NULL DEFAULT 0,
  lineup_continuity_5 REAL,
  rotation_index_5 REAL,
  matches_14 INTEGER NOT NULL DEFAULT 0,
  matches_28 INTEGER NOT NULL DEFAULT 0,
  competition_count_28 INTEGER NOT NULL DEFAULT 0,
  rest_days REAL,
  travel_km_14 REAL,
  travel_source TEXT,
  state_as_of TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soccer_team_state_league
  ON soccer_team_state(league_key,updated_at);

CREATE TABLE IF NOT EXISTS soccer_player_state (
  player_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  player_name TEXT,
  role_state TEXT,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  availability_reason TEXT,
  availability_source TEXT,
  availability_observed_at TEXT,
  expected_xi_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_match_date TEXT,
  last_start_date TEXT,
  appearances_28 INTEGER NOT NULL DEFAULT 0,
  starts_5 INTEGER NOT NULL DEFAULT 0,
  minutes_7 REAL NOT NULL DEFAULT 0,
  minutes_14 REAL NOT NULL DEFAULT 0,
  minutes_28 REAL NOT NULL DEFAULT 0,
  load_index_28 REAL,
  replacement_rank REAL,
  goalkeeper_evidence INTEGER NOT NULL DEFAULT 0,
  state_as_of TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soccer_player_state_team
  ON soccer_player_state(team_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_soccer_player_state_availability
  ON soccer_player_state(availability_status,availability_observed_at);

CREATE TABLE IF NOT EXISTS soccer_availability_observations (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  source TEXT NOT NULL,
  source_ref TEXT,
  observed_at TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soccer_availability_player_time
  ON soccer_availability_observations(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS soccer_team_state_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  league_key TEXT,
  target_match_id TEXT,
  snapshot_as_of TEXT NOT NULL,
  data_cutoff TEXT NOT NULL,
  state_json TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soccer_team_snapshot_team_time
  ON soccer_team_state_snapshots(team_id,snapshot_as_of DESC);

CREATE TABLE IF NOT EXISTS soccer_player_state_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  target_match_id TEXT,
  snapshot_as_of TEXT NOT NULL,
  data_cutoff TEXT NOT NULL,
  state_json TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soccer_player_snapshot_player_time
  ON soccer_player_state_snapshots(player_id,snapshot_as_of DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0063_soccer_persistent_state_research',datetime('now'));
