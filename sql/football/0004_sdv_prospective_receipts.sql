-- Run separately against NFL_DB and CFB_DB. Research only.
-- These are genuine pregame captures from the date of insertion, distinct
-- from the retrospective SDV PBP backfill. Never grants wager authority.
CREATE TABLE IF NOT EXISTS football_sdv_prospective_receipts (
 receipt_id TEXT PRIMARY KEY,
 sport TEXT NOT NULL CHECK(sport IN ('nfl','cfb')),
 game_id TEXT NOT NULL,
 model_id TEXT NOT NULL,
 model_version TEXT NOT NULL,
 baseline_snapshot_id TEXT NOT NULL,
 baseline_frozen_at TEXT NOT NULL,
 captured_at TEXT NOT NULL,
 kickoff TEXT NOT NULL,
 home_team_id TEXT NOT NULL,
 away_team_id TEXT NOT NULL,
 training_games INTEGER NOT NULL,
 training_drives INTEGER NOT NULL,
 home_reg_lead REAL NOT NULL CHECK(home_reg_lead BETWEEN 0 AND 1),
 away_reg_lead REAL NOT NULL CHECK(away_reg_lead BETWEEN 0 AND 1),
 reg_tie REAL NOT NULL CHECK(reg_tie BETWEEN 0 AND 1),
 home_blowout14 REAL NOT NULL CHECK(home_blowout14 BETWEEN 0 AND 1),
 away_blowout14 REAL NOT NULL CHECK(away_blowout14 BETWEEN 0 AND 1),
 projected_home REAL NOT NULL,
 projected_away REAL NOT NULL,
 evidence_json TEXT NOT NULL,
 authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY' CHECK(authority='RESEARCH_SHADOW_ONLY'),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
 UNIQUE(sport,game_id,model_id)
);
CREATE INDEX IF NOT EXISTS football_sdv_prospective_game
 ON football_sdv_prospective_receipts(sport,kickoff);
CREATE TABLE IF NOT EXISTS football_sdv_prospective_grades (
 receipt_id TEXT PRIMARY KEY NOT NULL,
 sport TEXT NOT NULL CHECK(sport IN ('nfl','cfb')),
 game_id TEXT NOT NULL,
 source_game_id TEXT NOT NULL,
 outcome_source_fingerprint TEXT NOT NULL,
 graded_at TEXT NOT NULL,
 source_observed_at TEXT NOT NULL,
 regulation_only INTEGER NOT NULL CHECK(regulation_only=1),
 actual_home INTEGER NOT NULL,
 actual_away INTEGER NOT NULL,
 authority TEXT NOT NULL DEFAULT 'RESEARCH_ONLY' CHECK(authority='RESEARCH_ONLY'),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
 FOREIGN KEY(receipt_id) REFERENCES football_sdv_prospective_receipts(receipt_id)
);
