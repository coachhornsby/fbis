-- Durable first-five results support late F5 settlement and long-term grading.
ALTER TABLE predictions ADD COLUMN f5_actual_home REAL;
ALTER TABLE predictions ADD COLUMN f5_actual_away REAL;
ALTER TABLE prediction_snapshots ADD COLUMN f5_actual_home REAL;
ALTER TABLE prediction_snapshots ADD COLUMN f5_actual_away REAL;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0014_operational_hardening', datetime('now'));
