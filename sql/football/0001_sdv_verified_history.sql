-- Identical additive schema in NFL_DB and CFB_DB. Historical SDV research only.
-- Never overwrite prior source captures; corrections create an additional fingerprint.
CREATE TABLE IF NOT EXISTS football_sdv_verified_games (
 sport TEXT NOT NULL CHECK(sport IN ('nfl','cfb')),
 game_id TEXT NOT NULL,
 season INTEGER NOT NULL,
 home_team_id TEXT NOT NULL,
 away_team_id TEXT NOT NULL,
 kickoff TEXT NOT NULL,
 source_observed_at TEXT NOT NULL,
 graded_at TEXT NOT NULL,
 source_asset TEXT NOT NULL,
 source_fingerprint TEXT NOT NULL,
 source_model TEXT NOT NULL CHECK(source_model IN
   ('NFL_PBP_VERIFIED_POSSESSIONS','SDV_ESPN_CFB_PBP_DRIVES')),
 score_home INTEGER NOT NULL,
 score_away INTEGER NOT NULL,
 drive_count INTEGER NOT NULL,
 drives_json TEXT NOT NULL,
 evidence_class TEXT NOT NULL DEFAULT 'POSTGAME_RECONSTRUCTED'
   CHECK(evidence_class='POSTGAME_RECONSTRUCTED'),
 prospective INTEGER NOT NULL DEFAULT 0 CHECK(prospective=0),
 authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY'
   CHECK(authority='RESEARCH_SHADOW_ONLY'),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
 PRIMARY KEY(sport,game_id,source_fingerprint)
);
CREATE INDEX IF NOT EXISTS football_sdv_games_time
 ON football_sdv_verified_games(sport,kickoff,source_observed_at);
CREATE INDEX IF NOT EXISTS football_sdv_games_teams
 ON football_sdv_verified_games(sport,home_team_id,away_team_id);
