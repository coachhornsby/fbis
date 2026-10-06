-- SOCCER-FBIS-v2 optional advanced independent features.
-- These columns are market-free and nullable. Production model remains functional
-- when an upstream rights-cleared source does not provide them.
ALTER TABLE soccer_matches ADD COLUMN home_xg REAL;
ALTER TABLE soccer_matches ADD COLUMN away_xg REAL;
ALTER TABLE soccer_matches ADD COLUMN home_ppda REAL;
ALTER TABLE soccer_matches ADD COLUMN away_ppda REAL;
ALTER TABLE soccer_matches ADD COLUMN home_deep_completions REAL;
ALTER TABLE soccer_matches ADD COLUMN away_deep_completions REAL;
ALTER TABLE soccer_matches ADD COLUMN home_expected_points REAL;
ALTER TABLE soccer_matches ADD COLUMN away_expected_points REAL;
ALTER TABLE soccer_matches ADD COLUMN advanced_source TEXT;
ALTER TABLE soccer_matches ADD COLUMN advanced_observed_at TEXT;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0052_soccer_v2_features', datetime('now'));
