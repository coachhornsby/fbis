-- 0109: freeze Tier 3 schema provenance + persist canonical team identity mapping.
-- Proprietary CSV bytes remain private in R2; this only extends the research index.
ALTER TABLE cfb_tier3_training_snapshots ADD COLUMN schema_version TEXT;
ALTER TABLE cfb_tier3_training_snapshots ADD COLUMN header_sha256 TEXT;
ALTER TABLE cfb_tier3_training_games ADD COLUMN home_canonical_id TEXT;
ALTER TABLE cfb_tier3_training_games ADD COLUMN away_canonical_id TEXT;
ALTER TABLE cfb_tier3_training_games ADD COLUMN identity_detail_json TEXT;
CREATE INDEX IF NOT EXISTS idx_cfb_tier3_games_home_canonical
  ON cfb_tier3_training_games(season, week, home_canonical_id);
CREATE INDEX IF NOT EXISTS idx_cfb_tier3_games_away_canonical
  ON cfb_tier3_training_games(season, week, away_canonical_id);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0109_cfb_tier3_schema_identity',datetime('now'));
