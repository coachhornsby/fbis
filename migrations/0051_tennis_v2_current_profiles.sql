-- Tennis v2 current research profiles and tournament court-speed state.
-- Research-only source lineage; never authorizes wagers.

ALTER TABLE tennis_market_snapshots ADD COLUMN event_start_time TEXT;
ALTER TABLE tennis_context_snapshots ADD COLUMN games_last_3_days REAL;
ALTER TABLE tennis_context_snapshots ADD COLUMN games_last_7_days REAL;
ALTER TABLE tennis_context_snapshots ADD COLUMN sets_last_3_days REAL;
ALTER TABLE tennis_context_snapshots ADD COLUMN sets_last_7_days REAL;

CREATE TABLE IF NOT EXISTS tennis_player_profiles_current (
  tour TEXT NOT NULL,
  player_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  surface TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  last_match_date TEXT,
  last_surface TEXT,
  last_tournament TEXT,
  games_last_3_days REAL,
  games_last_7_days REAL,
  sets_last_3_days REAL,
  sets_last_7_days REAL,
  days_since_retirement_or_mto REAL,
  source TEXT NOT NULL,
  source_license TEXT,
  source_as_of TEXT NOT NULL,
  production_dependency INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tour, player_key, surface)
);
CREATE INDEX IF NOT EXISTS idx_tennis_profiles_name
  ON tennis_player_profiles_current(tour, player_name, surface);
CREATE INDEX IF NOT EXISTS idx_tennis_profiles_updated
  ON tennis_player_profiles_current(updated_at, tour);

CREATE TABLE IF NOT EXISTS tennis_tournament_speed_current (
  tour TEXT NOT NULL,
  tournament_key TEXT NOT NULL,
  tournament_name TEXT NOT NULL,
  season INTEGER NOT NULL,
  surface TEXT NOT NULL,
  court_speed_index REAL,
  sample_sides INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  production_dependency INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tour, tournament_key, season)
);
CREATE INDEX IF NOT EXISTS idx_tennis_speed_surface
  ON tennis_tournament_speed_current(tour, surface, season, updated_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0051_tennis_v2_current_profiles', datetime('now'));
