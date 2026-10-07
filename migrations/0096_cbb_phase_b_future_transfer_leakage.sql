-- CBB Phase B explicit future-transfer leakage QA
ALTER TABLE cbb_game_state_snapshots ADD COLUMN future_transfer_leaks INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('0096_cbb_phase_b_future_transfer_leakage', datetime('now'));
