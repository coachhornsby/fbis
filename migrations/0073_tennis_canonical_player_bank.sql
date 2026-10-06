-- Canonical Tennis Player Bank identity + immutable observation layer.
-- Official ATP/WTA sources own identity/profile state; derived FBIS state remains separate.

CREATE TABLE IF NOT EXISTS tennis_players (
  fbis_player_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country_code TEXT,
  sex TEXT,
  date_of_birth TEXT,
  height_cm REAL,
  weight_kg REAL,
  handedness TEXT,
  backhand TEXT,
  turned_pro_year INTEGER,
  coach TEXT,
  active_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  official_headshot_url TEXT,
  official_headshot_source TEXT,
  current_rank INTEGER,
  ranking_points INTEGER,
  career_high_rank INTEGER,
  career_wins INTEGER,
  career_losses INTEGER,
  titles INTEGER,
  prize_money_usd REAL,
  official_source TEXT,
  official_source_player_id TEXT,
  official_source_priority INTEGER NOT NULL DEFAULT 0,
  official_effective_at TEXT,
  official_observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_players_tour_name ON tennis_players(tour, normalized_name);
CREATE INDEX IF NOT EXISTS idx_tennis_players_rank ON tennis_players(tour, current_rank);
CREATE INDEX IF NOT EXISTS idx_tennis_players_official_id ON tennis_players(official_source, official_source_player_id);

CREATE TABLE IF NOT EXISTS tennis_player_source_ids (
  provider TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  fbis_player_id TEXT NOT NULL,
  source_name TEXT,
  normalized_source_name TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  provenance_json TEXT,
  PRIMARY KEY (provider, source_player_id),
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_source_ids_fbis ON tennis_player_source_ids(fbis_player_id);

CREATE TABLE IF NOT EXISTS tennis_player_aliases (
  alias_normalized TEXT NOT NULL,
  fbis_player_id TEXT NOT NULL,
  alias_display TEXT,
  source TEXT NOT NULL,
  source_priority INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (alias_normalized, fbis_player_id, source),
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_alias_lookup ON tennis_player_aliases(alias_normalized, active);

CREATE TABLE IF NOT EXISTS tennis_profile_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_player_id TEXT,
  field_name TEXT NOT NULL,
  value_text TEXT,
  value_num REAL,
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  confidence REAL,
  superseded_by TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_profile_obs_current ON tennis_profile_observations(fbis_player_id, field_name, effective_at DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_profile_obs_source ON tennis_profile_observations(source, source_player_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_ranking_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  ranking_date TEXT NOT NULL,
  singles_rank INTEGER,
  points INTEGER,
  movement INTEGER,
  tournaments_played INTEGER,
  career_high_rank INTEGER,
  source TEXT NOT NULL,
  source_player_id TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_rank_unique
  ON tennis_ranking_observations(fbis_player_id, ranking_date, source);
CREATE INDEX IF NOT EXISTS idx_tennis_rank_pit
  ON tennis_ranking_observations(fbis_player_id, ranking_date DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_performance_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT,
  metric_name TEXT NOT NULL,
  raw_value REAL,
  normalized_value REAL,
  sample_matches INTEGER,
  source TEXT NOT NULL,
  source_player_id TEXT,
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  derived INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_perf_pit
  ON tennis_performance_observations(fbis_player_id, metric_name, scope_type, scope_value, effective_at DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_availability_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL,
  source_player_id TEXT,
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  confidence REAL,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_availability_pit
  ON tennis_availability_observations(fbis_player_id, effective_at DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_ingestion_state (
  source TEXT NOT NULL,
  tour TEXT NOT NULL,
  stream TEXT NOT NULL,
  cursor_value TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_started_at TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, tour, stream)
);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0073_tennis_canonical_player_bank', datetime('now'));
