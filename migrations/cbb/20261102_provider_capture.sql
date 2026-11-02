CREATE TABLE IF NOT EXISTS cbb_provider_capture_runs (
 run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, status TEXT NOT NULL, summary_json TEXT
);
CREATE TABLE IF NOT EXISTS cbb_provider_input_snapshots (
 run_id TEXT NOT NULL, source_key TEXT NOT NULL, metadata_json TEXT NOT NULL,
 payload_gzip_b64 TEXT, PRIMARY KEY(run_id,source_key)
);
