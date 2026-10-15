-- Reversible INDEX-ONLY space reclamation for the raw historical CFB roster.
-- Full 2004 row-by-row R2 archive and isolated 27-column remote restore verified,
-- including 13,644 exact records, with zero field mismatches.
-- Repo-wide audit found no runtime SQL reads of cfb_roster_observations.
-- Keep both PRIMARY/UNIQUE indexes, every row, PIT roster membership and model data.
-- Rollback DDL archived under
-- research/storage-recovery/2026-10-15/index-reclaim/preflight-bd15be02489162ff0e5b22368f2b780506fe66f618ad073e5f91b21c344d48e3.json
DROP INDEX IF EXISTS idx_cfb_roster_obs_player_time;
DROP INDEX IF EXISTS idx_cfb_roster_obs_team_time;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0108_cfb_archived_roster_index_retirement',datetime('now'));
