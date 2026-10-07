-- Prospective acquisition authority. Historical ledgers remain immutable evidence.
CREATE TABLE IF NOT EXISTS external_acquisition_policy (
 source TEXT PRIMARY KEY, actor TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'BLOCKED', reason TEXT NOT NULL,
 freshness_seconds INTEGER NOT NULL, per_run_cap_usd REAL NOT NULL, daily_cap_usd REAL NOT NULL,
 hourly_run_limit INTEGER NOT NULL, daily_run_limit INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_acquisition_account (
 id TEXT PRIMARY KEY CHECK(id='apify'), state TEXT NOT NULL, reason TEXT NOT NULL,
 period_start TEXT, period_end TEXT, provider_usage_usd REAL, usage_observed_at TEXT,
 target_usd REAL NOT NULL DEFAULT 22, hard_cap_usd REAL NOT NULL DEFAULT 25
);
INSERT OR IGNORE INTO external_acquisition_account(id,state,reason) VALUES('apify','BLOCKED','APIFY_USAGE_LIMIT_REACHED_RECONCILIATION_REQUIRED');
INSERT OR IGNORE INTO external_acquisition_policy VALUES('action','zen-studio~action-network-odds','BLOCKED','ACCOUNT_RESTRICTED',600,1.5,3,4,12,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO external_acquisition_policy VALUES('prizepicks','zen-studio~prizepicks-player-props','BLOCKED','ACCOUNT_RESTRICTED',86400,2,2,1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS external_acquisitions (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, actor TEXT NOT NULL, scope_hash TEXT NOT NULL, scope_json TEXT NOT NULL,
 origin TEXT NOT NULL, state TEXT NOT NULL, reserved_charge_usd REAL NOT NULL,
 provider_run_id TEXT UNIQUE, dataset_id TEXT, provider_status TEXT, provider_cost_usd REAL,
 cost_provenance TEXT, observations_returned INTEGER, raw_key TEXT, raw_hash TEXT,
 captured_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
);
CREATE INDEX IF NOT EXISTS external_acquisition_scope ON external_acquisitions(source,scope_hash,created_at);
CREATE INDEX IF NOT EXISTS external_acquisition_time ON external_acquisitions(created_at);
CREATE TABLE IF NOT EXISTS external_acquisition_consumers (
 acquisition_id TEXT NOT NULL, component TEXT NOT NULL, sport TEXT NOT NULL, requested_at TEXT NOT NULL,
 accepted INTEGER, duplicates INTEGER, rejected INTEGER, consumed_at TEXT,
 PRIMARY KEY(acquisition_id,component,sport)
);
CREATE TABLE IF NOT EXISTS external_acquisition_requests (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, component TEXT NOT NULL, sport TEXT NOT NULL, scope_hash TEXT NOT NULL,
 outcome TEXT NOT NULL, acquisition_id TEXT, reason TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_acquisition_batches (
 acquisition_id TEXT NOT NULL, component TEXT NOT NULL, batch_index INTEGER NOT NULL,
 rows_returned INTEGER NOT NULL, accepted INTEGER NOT NULL, duplicates INTEGER NOT NULL, rejected INTEGER NOT NULL,
 consumed_at TEXT NOT NULL, PRIMARY KEY(acquisition_id,component,batch_index)
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0097_apify_acquisition_authority',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
