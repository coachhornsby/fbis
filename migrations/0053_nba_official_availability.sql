-- Official NBA injury-report submission evidence.
CREATE TABLE IF NOT EXISTS nba_official_availability_reports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'NBA_OFFICIAL_INJURY_REPORT',
  report_url TEXT NOT NULL,
  report_timestamp TEXT NOT NULL,
  game_date TEXT,
  game_time_et TEXT,
  matchup TEXT,
  team_key TEXT NOT NULL,
  team_name TEXT,
  opponent_key TEXT,
  submission_status TEXT NOT NULL,
  player_rows INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_official_avail_team_time
  ON nba_official_availability_reports(team_key,report_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nba_official_avail_matchup_time
  ON nba_official_availability_reports(matchup,report_timestamp DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0053_nba_official_availability',datetime('now'));
