-- SOCCER-FBIS-v3 PitchAPI research feature store.
-- Market-free football observations only. Historical actual lineups are stored
-- with post_match=1 and are never eligible as pre-kick lineup evidence.

CREATE TABLE IF NOT EXISTS soccer_pitchapi_match_features (
  pitch_match_id TEXT PRIMARY KEY,
  fbis_event_id TEXT,
  league_key TEXT NOT NULL,
  pitch_league_id TEXT,
  pitch_league_name TEXT,
  season TEXT,
  match_date TEXT NOT NULL,
  start_time TEXT,
  status TEXT,
  home_team_id TEXT NOT NULL,
  home_team_name TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  home_score REAL,
  away_score REAL,
  home_xg REAL,
  away_xg REAL,
  home_xgot REAL,
  away_xgot REAL,
  home_shots INTEGER,
  away_shots INTEGER,
  home_sot INTEGER,
  away_sot INTEGER,
  home_big_chances REAL,
  away_big_chances REAL,
  home_ppda REAL,
  away_ppda REAL,
  home_field_tilt REAL,
  away_field_tilt REAL,
  home_final_third_entries REAL,
  away_final_third_entries REAL,
  home_box_entries REAL,
  away_box_entries REAL,
  home_high_turnovers REAL,
  away_high_turnovers REAL,
  home_counterpress_regains REAL,
  away_counterpress_regains REAL,
  home_ball_recovery_time REAL,
  away_ball_recovery_time REAL,
  home_xt REAL,
  away_xt REAL,
  home_vaep REAL,
  away_vaep REAL,
  home_progressive_passes REAL,
  away_progressive_passes REAL,
  home_progressive_carries REAL,
  away_progressive_carries REAL,
  home_xag REAL,
  away_xag REAL,
  home_possession REAL,
  away_possession REAL,
  home_passes_per_sequence REAL,
  away_passes_per_sequence REAL,
  home_direct_speed REAL,
  away_direct_speed REAL,
  source_observed_at TEXT NOT NULL,
  raw_advanced_json TEXT,
  raw_stats_json TEXT,
  raw_shots_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_soccer_league_date
  ON soccer_pitchapi_match_features(league_key,match_date,pitch_match_id);
CREATE INDEX IF NOT EXISTS idx_pitchapi_soccer_home_date
  ON soccer_pitchapi_match_features(home_team_id,match_date);
CREATE INDEX IF NOT EXISTS idx_pitchapi_soccer_away_date
  ON soccer_pitchapi_match_features(away_team_id,match_date);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_player_match (
  id TEXT PRIMARY KEY,
  pitch_match_id TEXT NOT NULL,
  league_key TEXT NOT NULL,
  match_date TEXT NOT NULL,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  minutes_played REAL,
  actions REAL,
  xt_total REAL,
  vaep_total REAL,
  xag REAL,
  xg_chain REAL,
  xg_buildup REAL,
  progressive_passes REAL,
  progressive_carries REAL,
  chances_created REAL,
  shots REAL,
  source_observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pitch_match_id,player_id)
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_player_history
  ON soccer_pitchapi_player_match(player_id,match_date);
CREATE INDEX IF NOT EXISTS idx_pitchapi_player_team_date
  ON soccer_pitchapi_player_match(team_id,match_date);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_lineup_observations (
  id TEXT PRIMARY KEY,
  pitch_match_id TEXT NOT NULL,
  league_key TEXT NOT NULL,
  team_id TEXT NOT NULL,
  side TEXT NOT NULL,
  kickoff_time TEXT,
  observed_at TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  lineup_type TEXT,
  formation TEXT,
  starters_json TEXT NOT NULL,
  subs_json TEXT,
  coach_name TEXT,
  pre_match INTEGER NOT NULL DEFAULT 0,
  post_match INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_lineup_match_time
  ON soccer_pitchapi_lineup_observations(pitch_match_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_pitchapi_lineup_team_time
  ON soccer_pitchapi_lineup_observations(team_id,observed_at);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_sync_runs (
  id TEXT PRIMARY KEY,
  league_key TEXT,
  pitch_league_id TEXT,
  season TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  matches_seen INTEGER NOT NULL DEFAULT 0,
  matches_persisted INTEGER NOT NULL DEFAULT 0,
  players_persisted INTEGER NOT NULL DEFAULT 0,
  lineups_persisted INTEGER NOT NULL DEFAULT 0,
  analytics_unavailable INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_sync_runs_time
  ON soccer_pitchapi_sync_runs(started_at DESC,league_key);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0057_soccer_pitchapi_v3',datetime('now'));
