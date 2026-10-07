-- CBB Phase B explicit temporal-integrity QA without rewriting the large snapshot table.
-- Bounded table creation keeps the migration idempotent and avoids D1 large-table copy/reset behavior.
CREATE TABLE IF NOT EXISTS cbb_directory_phase_b_temporal_qa (
  run_id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  post_tip_observations INTEGER NOT NULL DEFAULT 0,
  future_membership_leaks INTEGER NOT NULL DEFAULT 0,
  future_availability_leaks INTEGER NOT NULL DEFAULT 0,
  future_lineup_leaks INTEGER NOT NULL DEFAULT 0,
  future_transfer_leaks INTEGER NOT NULL DEFAULT 0,
  temporal_integrity_ok INTEGER NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(id, applied_at)
VALUES ('0096_cbb_phase_b_future_transfer_leakage', datetime('now'));
