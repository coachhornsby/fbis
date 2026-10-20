-- Additive expiry/revocation columns for sport cutover approvals (CORE_DB).
-- Safe to re-run only when columns are missing; apply via operator migration once.

ALTER TABLE fbis_sport_cutover_approvals ADD COLUMN expires_at TEXT;
ALTER TABLE fbis_sport_cutover_approvals ADD COLUMN revoked_at TEXT;

INSERT OR REPLACE INTO fbis_topology_migrations(migration_id, applied_at, notes)
VALUES (
  'core-v1-cutover-approvals-expiry',
  datetime('now'),
  'Expired or revoked CORE cutover receipts must fail closed'
);
