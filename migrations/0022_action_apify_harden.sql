-- Action/Apify candidate hardening (additive).
-- Durable scheduler lease/circuit + observation enrichment columns.
-- Shadow/candidate only. Never grants canQualify / canAuthorizeWager.
-- Never enters ODDS_PROVIDER_ORDER. Never feeds CFB-FBIS-v2 features.
-- 0021 is already deployed — do not mutate it.

CREATE TABLE IF NOT EXISTS shadow_candidate_scheduler_state (
  provider TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  active_run_id TEXT,
  lease_acquired_at TEXT,
  lease_expires_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TEXT,
  last_run_id TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error_class TEXT,
  last_error_message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_shadow_scheduler_lease_expires
  ON shadow_candidate_scheduler_state (lease_expires_at);

-- Enrich 0020 observation rows for championship join + temporal integrity.
ALTER TABLE shadow_market_observations ADD COLUMN fbis_event_id TEXT;
ALTER TABLE shadow_market_observations ADD COLUMN sport TEXT;
ALTER TABLE shadow_market_observations ADD COLUMN temporal_class TEXT;
ALTER TABLE shadow_market_observations ADD COLUMN match_confidence TEXT;
ALTER TABLE shadow_market_observations ADD COLUMN collected_at TEXT;
ALTER TABLE shadow_market_observations ADD COLUMN source_observed_at TEXT;
ALTER TABLE shadow_market_observations ADD COLUMN evaluation_close INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_shadow_market_obs_fbis
  ON shadow_market_observations (fbis_event_id, sport);
CREATE INDEX IF NOT EXISTS idx_shadow_market_obs_sport_collected
  ON shadow_market_observations (sport, collected_at);

-- Run-level idempotency + match denominators on 0021 collection runs.
ALTER TABLE shadow_collection_runs ADD COLUMN logical_collection_key TEXT;
ALTER TABLE shadow_collection_runs ADD COLUMN fbis_events_expected INTEGER;
ALTER TABLE shadow_collection_runs ADD COLUMN action_events_returned INTEGER;
ALTER TABLE shadow_collection_runs ADD COLUMN matched_events INTEGER;
ALTER TABLE shadow_collection_runs ADD COLUMN ambiguous_events INTEGER;
ALTER TABLE shadow_collection_runs ADD COLUMN action_only_events INTEGER;
ALTER TABLE shadow_collection_runs ADD COLUMN fbis_only_events INTEGER;
ALTER TABLE shadow_collection_runs ADD COLUMN previous_schema_fingerprint TEXT;
ALTER TABLE shadow_collection_runs ADD COLUMN schema_drift_detail_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_collection_logical_key
  ON shadow_collection_runs (logical_collection_key)
  WHERE logical_collection_key IS NOT NULL;

-- Decision-window reliability (lifecycle already on runs; mirror onto reliability).
ALTER TABLE shadow_provider_reliability ADD COLUMN lifecycle TEXT;
ALTER TABLE shadow_provider_reliability ADD COLUMN fbis_events_expected INTEGER;
ALTER TABLE shadow_provider_reliability ADD COLUMN matched_events INTEGER;
ALTER TABLE shadow_provider_reliability ADD COLUMN ambiguous_events INTEGER;

-- Observation key semantics: separate run idempotency from temporal resampling.
ALTER TABLE shadow_observation_keys ADD COLUMN run_idempotency_key TEXT;
ALTER TABLE shadow_observation_keys ADD COLUMN sampling_kind TEXT;
ALTER TABLE shadow_observation_keys ADD COLUMN fbis_event_id TEXT;
ALTER TABLE shadow_observation_keys ADD COLUMN line REAL;
ALTER TABLE shadow_observation_keys ADD COLUMN price REAL;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0022_action_apify_harden', datetime('now'));
