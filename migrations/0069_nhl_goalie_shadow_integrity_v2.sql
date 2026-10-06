-- NHL goalie-shadow prospective integrity/provenance fields.
-- Additive only. Research/shadow only; no qualification or wager authority.

ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'FROZEN';
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_goalie_confirmation_state TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_goalie_confirmation_state TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_expected_starter_id TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_expected_starter_id TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_expected_starter_name TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_expected_starter_name TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_expected_start_probability REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_expected_start_probability REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN goalie_evidence_source TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN goalie_evidence_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN deployment_evidence_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN availability_evidence_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN market_observed_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN temporal_integrity_passed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN temporal_integrity_json TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN probability_delta REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN starter_quality_delta REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN goalie_usage_state TEXT;

CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_lifecycle
  ON nhl_goalie_probability_shadow(lifecycle,graded_at,feature_cutoff_timestamp);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_integrity
  ON nhl_goalie_probability_shadow(temporal_integrity_passed,feature_cutoff_timestamp);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0069_nhl_goalie_shadow_integrity_v2',datetime('now'));
