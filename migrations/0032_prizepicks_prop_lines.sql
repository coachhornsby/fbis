-- 0032_prizepicks_prop_lines.sql
CREATE TABLE IF NOT EXISTS prizepicks_prop_lines (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  projection_id TEXT,
  fbis_event_id TEXT,
  sport TEXT NOT NULL,
  league TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  game_id TEXT,
  start_time TEXT,
  stat_type TEXT NOT NULL,
  canonical_market TEXT,
  line REAL NOT NULL,
  odds_tier TEXT,
  duration TEXT,
  fbis_projection REAL,
  fbis_sigma REAL,
  delta_fbis_minus_line REAL,
  candidate_side TEXT,
  observed_at TEXT,
  collected_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prizepicks_prop_lines_sport_time
  ON prizepicks_prop_lines(sport, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_prizepicks_prop_lines_event
  ON prizepicks_prop_lines(fbis_event_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_prizepicks_prop_lines_player_market
  ON prizepicks_prop_lines(player_name, canonical_market, collected_at DESC);
