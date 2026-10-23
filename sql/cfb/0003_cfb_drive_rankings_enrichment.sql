-- Dedicated CFB_DB additive research enrichment. Not part of primary FBIS D1.
-- One verified same-seed replay per existing immutable CFB V2 research receipt.
CREATE TABLE IF NOT EXISTS cfb_drive_rankings_enrichment (
  run_id TEXT PRIMARY KEY NOT NULL,
  source_simulator_version TEXT NOT NULL CHECK(source_simulator_version='CFB-DRIVE-STATE-SHADOW-v2'),
  original_seed INTEGER NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  replayed_at TEXT NOT NULL,
  ranking_metrics_json TEXT NOT NULL,
  authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY' CHECK(authority='RESEARCH_SHADOW_ONLY'),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
  FOREIGN KEY(run_id) REFERENCES cfb_drive_shadow_runs(id)
);
