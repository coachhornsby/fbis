-- 0111: CFB SDV/CFBD data operations — collection manifests, CORE weekly PIT archive,
-- canonical feature lineage receipts. Research governance only; no champion coefficient changes.

CREATE TABLE IF NOT EXISTS cfb_collection_manifests (
  manifest_id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  provider TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  status TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  http_ok INTEGER,
  row_count INTEGER,
  team_coverage INTEGER,
  through_week INTEGER,
  schema_ok INTEGER,
  content_hash TEXT,
  ingestion_batch_id TEXT,
  collected_at TEXT,
  alerts_json TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_collection_manifests_season_week
  ON cfb_collection_manifests(season, week, dataset_id);
CREATE INDEX IF NOT EXISTS idx_cfb_collection_manifests_status
  ON cfb_collection_manifests(status, required);

CREATE TABLE IF NOT EXISTS cfb_core_weekly_archive (
  archive_id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  through_week INTEGER NOT NULL,
  target_week INTEGER,
  school_key TEXT NOT NULL,
  core REAL,
  core_offense REAL,
  core_defense REAL,
  core_special_teams REAL,
  year INTEGER,
  through_season_type TEXT,
  source_endpoint TEXT NOT NULL DEFAULT '/ratings/core',
  publication_time TEXT,
  collection_time TEXT NOT NULL,
  ingestion_batch_id TEXT,
  job_run_id TEXT,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK (research_only = 1),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK (can_influence_projection = 0),
  archive_version TEXT NOT NULL DEFAULT 'cfb-core-weekly-archive-v1',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_core_archive_season_week
  ON cfb_core_weekly_archive(season, through_week);
CREATE INDEX IF NOT EXISTS idx_cfb_core_archive_school
  ON cfb_core_weekly_archive(school_key, season, through_week DESC);

CREATE TABLE IF NOT EXISTS cfb_feature_lineage_receipts (
  receipt_id TEXT PRIMARY KEY,
  season INTEGER,
  week INTEGER,
  game_id TEXT,
  team_id TEXT,
  provider TEXT NOT NULL,
  source_dataset TEXT,
  original_field TEXT,
  canonical_feature TEXT NOT NULL,
  units TEXT,
  original_value TEXT,
  transformed_value TEXT,
  transformations_json TEXT,
  publication_time TEXT,
  collection_time TEXT,
  ingestion_batch_id TEXT,
  validation_status TEXT,
  model_eligibility TEXT,
  missingness INTEGER NOT NULL DEFAULT 0,
  data_quality_flags_json TEXT,
  content_hash TEXT,
  model_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_lineage_game
  ON cfb_feature_lineage_receipts(game_id, canonical_feature);
CREATE INDEX IF NOT EXISTS idx_cfb_lineage_team_season
  ON cfb_feature_lineage_receipts(team_id, season, week);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0111_cfb_data_ops', datetime('now'));
