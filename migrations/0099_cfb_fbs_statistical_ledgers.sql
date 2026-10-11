-- FBS-only research statistic storage, additive and forward-only.
-- Requires the reviewed 0098 recovery and independent production preflight.
-- The data is POSTGAME research. No activation of model/prop/wager authority.
SELECT CASE WHEN EXISTS(
 SELECT 1 FROM schema_migrations WHERE id='0098_college_persistence_recovery'
) AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_observations')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_feature_snapshots')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_feature_snapshots')
THEN 1 ELSE json('cfb_stat_0099_requires_0098') END AS predecessor_verified;

CREATE TABLE IF NOT EXISTS cfb_team_game_stat_observations (
 id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 game_id TEXT NOT NULL,
 season INTEGER NOT NULL,
 opponent TEXT,
 game_at TEXT NOT NULL,
 source TEXT NOT NULL,
 source_timestamp TEXT,
 observed_at TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 temporal_class TEXT NOT NULL DEFAULT 'POSTGAME_ARCHIVE_NOT_PIT',
 metrics_json TEXT NOT NULL,
 ingested_at TEXT NOT NULL,
 can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK (can_influence_projection=0),
 UNIQUE(team_id,game_id,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_game_stats_team
 ON cfb_team_game_stat_observations(team_id,season,game_at DESC);

CREATE TABLE IF NOT EXISTS cfb_team_season_stat_snapshots (
 id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 season INTEGER NOT NULL,
 source TEXT NOT NULL,
 source_timestamp TEXT,
 observed_at TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 metrics_json TEXT NOT NULL,
 source_game_ids_json TEXT,
 ingestion_version TEXT,
 can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK (can_influence_projection=0),
 UNIQUE(team_id,season,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_season_stats
 ON cfb_team_season_stat_snapshots(team_id,season,observed_at DESC);

CREATE TABLE IF NOT EXISTS cfb_player_game_stat_observations (
 id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 player_id TEXT NOT NULL,
 game_id TEXT NOT NULL,
 season INTEGER NOT NULL,
 opponent TEXT,
 game_at TEXT NOT NULL,
 source TEXT NOT NULL,
 source_timestamp TEXT,
 observed_at TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 temporal_class TEXT NOT NULL DEFAULT 'POSTGAME_ARCHIVE_NOT_PIT',
 metrics_json TEXT NOT NULL,
 ingested_at TEXT NOT NULL,
 can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK (can_influence_projection=0),
 UNIQUE(team_id,player_id,game_id,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_game_stats_player
 ON cfb_player_game_stat_observations(team_id,season,player_id,game_at DESC);

CREATE TABLE IF NOT EXISTS cfb_player_season_stat_snapshots (
 id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 player_id TEXT NOT NULL,
 season INTEGER NOT NULL,
 source TEXT NOT NULL,
 source_timestamp TEXT,
 observed_at TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 metrics_json TEXT NOT NULL,
 source_game_ids_json TEXT,
 ingestion_version TEXT,
 can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK (can_influence_projection=0),
 UNIQUE(team_id,player_id,season,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_season_stats
 ON cfb_player_season_stat_snapshots(team_id,season,player_id,observed_at DESC);

-- Verify all four research-only contracts and required indexes before recording tip.
SELECT CASE WHEN
 (SELECT COUNT(*) FROM pragma_table_info('cfb_team_game_stat_observations'))=15
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_cfb_team_game_stats_team' AND type='index')
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_game_stat_observations'
   AND instr(replace(sql,' ',''),'CHECK(can_influence_projection=0)')>0)
 THEN 1 ELSE json('cfb_stat_0099_cfb_team_game_stat_observations_contract_mismatch') END AS cfb_team_game_stat_observations_verified;
SELECT CASE WHEN
 (SELECT COUNT(*) FROM pragma_table_info('cfb_team_season_stat_snapshots'))=12
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_cfb_team_season_stats' AND type='index')
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_season_stat_snapshots'
   AND instr(replace(sql,' ',''),'CHECK(can_influence_projection=0)')>0)
 THEN 1 ELSE json('cfb_stat_0099_cfb_team_season_stat_snapshots_contract_mismatch') END AS cfb_team_season_stat_snapshots_verified;
SELECT CASE WHEN
 (SELECT COUNT(*) FROM pragma_table_info('cfb_player_game_stat_observations'))=16
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_cfb_player_game_stats_player' AND type='index')
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_game_stat_observations'
   AND instr(replace(sql,' ',''),'CHECK(can_influence_projection=0)')>0)
 THEN 1 ELSE json('cfb_stat_0099_cfb_player_game_stat_observations_contract_mismatch') END AS cfb_player_game_stat_observations_verified;
SELECT CASE WHEN
 (SELECT COUNT(*) FROM pragma_table_info('cfb_player_season_stat_snapshots'))=13
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_cfb_player_season_stats' AND type='index')
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_season_stat_snapshots'
   AND instr(replace(sql,' ',''),'CHECK(can_influence_projection=0)')>0)
 THEN 1 ELSE json('cfb_stat_0099_cfb_player_season_stat_snapshots_contract_mismatch') END AS cfb_player_season_stat_snapshots_verified;
INSERT OR IGNORE INTO schema_migrations (id,applied_at)
 VALUES ('0099_cfb_fbs_statistical_ledgers',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
