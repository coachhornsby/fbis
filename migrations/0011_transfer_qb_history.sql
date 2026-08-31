-- Durable transfer QB identity/performance history for CFB shadow features.

CREATE TABLE IF NOT EXISTS qb_transfer_history (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  player_name TEXT,
  season INTEGER NOT NULL,
  source_school TEXT,
  source_team_id TEXT,
  destination_school TEXT,
  destination_team_id TEXT,
  position TEXT,
  transfer_date TEXT,
  games_started INTEGER,
  pass_attempts INTEGER,
  usage REAL,
  passing_ppa REAL,
  passing_wepa REAL,
  success_rate REAL,
  explosive_rate REAL,
  sack_rate REAL,
  turnover_rate REAL,
  ypa REAL,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cfbd',
  source_obs_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qb_transfer_dest ON qb_transfer_history (season, destination_school);
CREATE INDEX IF NOT EXISTS idx_qb_transfer_player ON qb_transfer_history (player_id, season);

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0011_transfer_qb_history', datetime('now'));
