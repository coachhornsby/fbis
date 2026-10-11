-- Forward-only recovery of five verified college persistence contracts.
-- No existing rows, model/authority tables or historical migrations are rewritten.
CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  season INTEGER,
  partition_key TEXT,
  observed_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  schema_version TEXT,
  record_count INTEGER,
  content_hash TEXT,
  r2_key TEXT,
  status TEXT,
  job_run_id TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_obs_src ON source_observations (source, sport, endpoint, season);
CREATE TABLE IF NOT EXISTS team_feature_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  features_json TEXT,
  missingness_json TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_feat ON team_feature_snapshots (sport, team_id, as_of);
CREATE TABLE IF NOT EXISTS game_feature_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  home_team_id TEXT,
  away_team_id TEXT,
  scheduled_start TEXT,
  feature_cutoff TEXT NOT NULL,
  source_obs_json TEXT,
  source_versions_json TEXT,
  feature_schema_version TEXT,
  model_version TEXT,
  neutral INTEGER,
  missingness_json TEXT,
  data_quality REAL,
  content_hash TEXT,
  job_run_id TEXT,
  features_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_feat ON game_feature_snapshots (sport, game_id, feature_cutoff);
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  month TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  records_returned INTEGER,
  quota_cost INTEGER,
  ok INTEGER,
  reason TEXT,
  query_keys TEXT,
  elapsed_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_usage_month ON api_usage (month, source, endpoint);
CREATE TABLE IF NOT EXISTS team_season_identity (
  canonical_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  source_team_id TEXT,
  espn_id TEXT,
  school TEXT,
  display_name TEXT,
  abbr TEXT,
  conference TEXT,
  classification TEXT,
  aliases_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (canonical_id, season)
);

-- Bounded source_observations guard: compatible with D1's expression-depth limit.
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_observations' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEsource_observations(idTEXTPRIMARYKEY,sourceTEXTNOTNULL,sportTEXTNOTNULL,endpointTEXTNOTNULL,seasonINTEGER,partition_keyTEXT,observed_atTEXTNOTNULL,retrieved_atTEXTNOTNULL,schema_versionTEXT,record_countINTEGER,content_hashTEXT,r2_keyTEXT,statusTEXT,job_run_idTEXT,meta_jsonTEXT)')
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='source_observations')=0
 AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='source_observations' AND sql IS NOT NULL)=1
 AND (SELECT count(*) FROM pragma_table_info('source_observations'))=15
 AND (SELECT count(*) FROM pragma_foreign_key_list('source_observations'))=0
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=1 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='source' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='sport' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='endpoint' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='season' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='partition_key' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='observed_at' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='retrieved_at' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='schema_version' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='record_count' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='content_hash' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='r2_key' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='status' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='job_run_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('source_observations') WHERE name='meta_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_source_obs_src' AND tbl_name='source_observations' AND replace(sql,' IF NOT EXISTS','')='CREATE INDEX idx_source_obs_src ON source_observations (source, sport, endpoint, season)') THEN 1 ELSE json('source_observations: contract mismatch') END AS source_observations_verified;

-- Bounded team_feature_snapshots guard: compatible with D1's expression-depth limit.
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_feature_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEteam_feature_snapshots(idTEXTPRIMARYKEY,sportTEXTNOTNULL,team_idTEXTNOTNULL,seasonINTEGER,as_ofTEXTNOTNULL,feature_versionTEXTNOTNULL,features_jsonTEXT,missingness_jsonTEXT,content_hashTEXT,job_run_idTEXT,created_atTEXTNOTNULL)')
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='team_feature_snapshots')=0
 AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='team_feature_snapshots' AND sql IS NOT NULL)=1
 AND (SELECT count(*) FROM pragma_table_info('team_feature_snapshots'))=11
 AND (SELECT count(*) FROM pragma_foreign_key_list('team_feature_snapshots'))=0
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=1 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='sport' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='team_id' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='season' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='as_of' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='feature_version' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='features_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='missingness_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='content_hash' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='job_run_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_feature_snapshots') WHERE name='created_at' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_team_feat' AND tbl_name='team_feature_snapshots' AND replace(sql,' IF NOT EXISTS','')='CREATE INDEX idx_team_feat ON team_feature_snapshots (sport, team_id, as_of)') THEN 1 ELSE json('team_feature_snapshots: contract mismatch') END AS team_feature_snapshots_verified;

-- Bounded game_feature_snapshots guard: compatible with D1's expression-depth limit.
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_feature_snapshots' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEgame_feature_snapshots(idTEXTPRIMARYKEY,sportTEXTNOTNULL,game_idTEXTNOTNULL,home_team_idTEXT,away_team_idTEXT,scheduled_startTEXT,feature_cutoffTEXTNOTNULL,source_obs_jsonTEXT,source_versions_jsonTEXT,feature_schema_versionTEXT,model_versionTEXT,neutralINTEGER,missingness_jsonTEXT,data_qualityREAL,content_hashTEXT,job_run_idTEXT,features_jsonTEXT,created_atTEXTNOTNULL)')
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='game_feature_snapshots')=0
 AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='game_feature_snapshots' AND sql IS NOT NULL)=1
 AND (SELECT count(*) FROM pragma_table_info('game_feature_snapshots'))=18
 AND (SELECT count(*) FROM pragma_foreign_key_list('game_feature_snapshots'))=0
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=1 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='sport' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='game_id' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='home_team_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='away_team_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='scheduled_start' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='feature_cutoff' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='source_obs_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='source_versions_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='feature_schema_version' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='model_version' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='neutral' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='missingness_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='data_quality' AND upper(type)='REAL' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='content_hash' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='job_run_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='features_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('game_feature_snapshots') WHERE name='created_at' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_game_feat' AND tbl_name='game_feature_snapshots' AND replace(sql,' IF NOT EXISTS','')='CREATE INDEX idx_game_feat ON game_feature_snapshots (sport, game_id, feature_cutoff)') THEN 1 ELSE json('game_feature_snapshots: contract mismatch') END AS game_feature_snapshots_verified;

-- Bounded api_usage guard: compatible with D1's expression-depth limit.
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_usage' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEapi_usage(idINTEGERPRIMARYKEYAUTOINCREMENT,sourceTEXTNOTNULL,endpointTEXTNOTNULL,monthTEXTNOTNULL,captured_atTEXTNOTNULL,cache_hitINTEGERNOTNULLDEFAULT0,http_statusINTEGER,records_returnedINTEGER,quota_costINTEGER,okINTEGER,reasonTEXT,query_keysTEXT,elapsed_msINTEGER)')
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='api_usage')=0
 AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='api_usage' AND sql IS NOT NULL)=1
 AND (SELECT count(*) FROM pragma_table_info('api_usage'))=13
 AND (SELECT count(*) FROM pragma_foreign_key_list('api_usage'))=0
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='id' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=1 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='source' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='endpoint' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='month' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='captured_at' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='cache_hit' AND upper(type)='INTEGER' AND "notnull"=1 AND pk=0 AND dflt_value IS '0')
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='http_status' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='records_returned' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='quota_cost' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='ok' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='reason' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='query_keys' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('api_usage') WHERE name='elapsed_ms' AND upper(type)='INTEGER' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_api_usage_month' AND tbl_name='api_usage' AND replace(sql,' IF NOT EXISTS','')='CREATE INDEX idx_api_usage_month ON api_usage (month, source, endpoint)') THEN 1 ELSE json('api_usage: contract mismatch') END AS api_usage_verified;

-- Bounded team_season_identity guard: compatible with D1's expression-depth limit.
SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_season_identity' AND replace(replace(replace(replace(sql,char(10),''),char(13),''),char(9),''),' ','')='CREATETABLEteam_season_identity(canonical_idTEXTNOTNULL,sportTEXTNOTNULL,seasonINTEGERNOTNULL,source_team_idTEXT,espn_idTEXT,schoolTEXT,display_nameTEXT,abbrTEXT,conferenceTEXT,classificationTEXT,aliases_jsonTEXT,updated_atTEXTNOTNULL,PRIMARYKEY(canonical_id,season))')
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='team_season_identity')=0
 AND (SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='team_season_identity' AND sql IS NOT NULL)=0
 AND (SELECT count(*) FROM pragma_table_info('team_season_identity'))=12
 AND (SELECT count(*) FROM pragma_foreign_key_list('team_season_identity'))=0
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='canonical_id' AND upper(type)='TEXT' AND "notnull"=1 AND pk=1 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='sport' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='season' AND upper(type)='INTEGER' AND "notnull"=1 AND pk=2 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='source_team_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='espn_id' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='school' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='display_name' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='abbr' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='conference' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='classification' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='aliases_json' AND upper(type)='TEXT' AND "notnull"=0 AND pk=0 AND dflt_value IS NULL)
 AND EXISTS(SELECT 1 FROM pragma_table_info('team_season_identity') WHERE name='updated_at' AND upper(type)='TEXT' AND "notnull"=1 AND pk=0 AND dflt_value IS NULL) THEN 1 ELSE json('team_season_identity: contract mismatch') END AS team_season_identity_verified;

INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0098_college_persistence_recovery',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

