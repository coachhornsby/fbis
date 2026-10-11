-- FBS-only research statistic storage, additive and forward-only.
-- Requires the reviewed 0098 recovery and independent production preflight.
-- The data is POSTGAME research. No activation of model/prop/wager authority.
SELECT CASE WHEN EXISTS(
 SELECT 1 FROM schema_migrations WHERE id='0098_college_persistence_recovery'
) AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_observations')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_feature_snapshots')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_feature_snapshots')
THEN 1 ELSE json('cfb_stat_0099_requires_0098') END AS predecessor_verified;

-- Reject conflicting existing schemas before any DDL.
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_game_stat_observations') OR (EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_game_stat_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_player_game_stat_observations(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,player_idTEXTNOTNULL,game_idTEXTNOTNULL,seasonINTEGERNOTNULL,opponentTEXT,game_atTEXTNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,temporal_classTEXTNOTNULLDEFAULT''POSTGAME_ARCHIVE_NOT_PIT'',metrics_jsonTEXTNOTNULL,ingested_atTEXTNOTNULL,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,player_id,game_id,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_player_game_stat_observations')=0 AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='cfb_player_game_stat_observations' AND sql IS NOT NULL AND NOT ((name='idx_cfb_player_game_stats_player' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_player_game_stats_playerONcfb_player_game_stat_observations(team_id,season,player_id,game_atDESC)')))) THEN 1 ELSE json('cfb_player_game_stat_observations: preflight contract mismatch') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_season_stat_snapshots') OR (EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_season_stat_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_player_season_stat_snapshots(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,player_idTEXTNOTNULL,seasonINTEGERNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,metrics_jsonTEXTNOTNULL,source_game_ids_jsonTEXT,ingestion_versionTEXT,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,player_id,season,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_player_season_stat_snapshots')=0 AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='cfb_player_season_stat_snapshots' AND sql IS NOT NULL AND NOT ((name='idx_cfb_player_season_stats' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_player_season_statsONcfb_player_season_stat_snapshots(team_id,season,player_id,observed_atDESC)')))) THEN 1 ELSE json('cfb_player_season_stat_snapshots: preflight contract mismatch') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_game_stat_observations') OR (EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_game_stat_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_team_game_stat_observations(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,game_idTEXTNOTNULL,seasonINTEGERNOTNULL,opponentTEXT,game_atTEXTNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,temporal_classTEXTNOTNULLDEFAULT''POSTGAME_ARCHIVE_NOT_PIT'',metrics_jsonTEXTNOTNULL,ingested_atTEXTNOTNULL,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,game_id,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_team_game_stat_observations')=0 AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='cfb_team_game_stat_observations' AND sql IS NOT NULL AND NOT ((name='idx_cfb_team_game_stats_team' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_team_game_stats_teamONcfb_team_game_stat_observations(team_id,season,game_atDESC)')))) THEN 1 ELSE json('cfb_team_game_stat_observations: preflight contract mismatch') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_season_stat_snapshots') OR (EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_season_stat_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_team_season_stat_snapshots(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,seasonINTEGERNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,metrics_jsonTEXTNOTNULL,source_game_ids_jsonTEXT,ingestion_versionTEXT,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,season,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_team_season_stat_snapshots')=0 AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='cfb_team_season_stat_snapshots' AND sql IS NOT NULL AND NOT ((name='idx_cfb_team_season_stats' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_team_season_statsONcfb_team_season_stat_snapshots(team_id,season,observed_atDESC)')))) THEN 1 ELSE json('cfb_team_season_stat_snapshots: preflight contract mismatch') END;

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

-- Exact table constraints, indexes and trigger inventory.
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_game_stat_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_player_game_stat_observations(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,player_idTEXTNOTNULL,game_idTEXTNOTNULL,seasonINTEGERNOTNULL,opponentTEXT,game_atTEXTNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,temporal_classTEXTNOTNULLDEFAULT''POSTGAME_ARCHIVE_NOT_PIT'',metrics_jsonTEXTNOTNULL,ingested_atTEXTNOTNULL,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,player_id,game_id,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_player_game_stat_observations')=0 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_cfb_player_game_stats_player' AND tbl_name='cfb_player_game_stat_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_player_game_stats_playerONcfb_player_game_stat_observations(team_id,season,player_id,game_atDESC)') AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='cfb_player_game_stat_observations' AND sql IS NOT NULL)=1 THEN 1 ELSE json('cfb_player_game_stat_observations: complete contract mismatch') END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_player_season_stat_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_player_season_stat_snapshots(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,player_idTEXTNOTNULL,seasonINTEGERNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,metrics_jsonTEXTNOTNULL,source_game_ids_jsonTEXT,ingestion_versionTEXT,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,player_id,season,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_player_season_stat_snapshots')=0 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_cfb_player_season_stats' AND tbl_name='cfb_player_season_stat_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_player_season_statsONcfb_player_season_stat_snapshots(team_id,season,player_id,observed_atDESC)') AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='cfb_player_season_stat_snapshots' AND sql IS NOT NULL)=1 THEN 1 ELSE json('cfb_player_season_stat_snapshots: complete contract mismatch') END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_game_stat_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_team_game_stat_observations(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,game_idTEXTNOTNULL,seasonINTEGERNOTNULL,opponentTEXT,game_atTEXTNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,temporal_classTEXTNOTNULLDEFAULT''POSTGAME_ARCHIVE_NOT_PIT'',metrics_jsonTEXTNOTNULL,ingested_atTEXTNOTNULL,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,game_id,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_team_game_stat_observations')=0 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_cfb_team_game_stats_team' AND tbl_name='cfb_team_game_stat_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_team_game_stats_teamONcfb_team_game_stat_observations(team_id,season,game_atDESC)') AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='cfb_team_game_stat_observations' AND sql IS NOT NULL)=1 THEN 1 ELSE json('cfb_team_game_stat_observations: complete contract mismatch') END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfb_team_season_stat_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEcfb_team_season_stat_snapshots(idTEXTPRIMARYKEY,team_idTEXTNOTNULL,seasonINTEGERNOTNULL,sourceTEXTNOTNULL,source_timestampTEXT,observed_atTEXTNOTNULL,content_hashTEXTNOTNULL,metrics_jsonTEXTNOTNULL,source_game_ids_jsonTEXT,ingestion_versionTEXT,can_influence_projectionINTEGERNOTNULLDEFAULT0CHECK(can_influence_projection=0),UNIQUE(team_id,season,source,content_hash))') AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='cfb_team_season_stat_snapshots')=0 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_cfb_team_season_stats' AND tbl_name='cfb_team_season_stat_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATEINDEXidx_cfb_team_season_statsONcfb_team_season_stat_snapshots(team_id,season,observed_atDESC)') AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='cfb_team_season_stat_snapshots' AND sql IS NOT NULL)=1 THEN 1 ELSE json('cfb_team_season_stat_snapshots: complete contract mismatch') END;
INSERT OR IGNORE INTO schema_migrations (id,applied_at)
 VALUES ('0099_cfb_fbs_statistical_ledgers',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
