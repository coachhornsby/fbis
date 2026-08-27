-- Record applied integrity migrations. Idempotent.

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0001_job_runs', datetime('now'));
INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0002_strategy_ticket_prices', datetime('now'));
INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0003_record_applied', datetime('now'));
