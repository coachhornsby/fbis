-- Narrow the tennis player library to currently ranked / active athletes.
-- Historical identity rows are retained but marked LIBRARY_INACTIVE so slate
-- attachment and directory surfaces prefer RANKED_ACTIVE only.
--
-- RANKED_ACTIVE     = present on the current singles ranking (or bank rank for ATP research)
-- LIBRARY_INACTIVE  = known identity retained for provenance, excluded from active library
-- UNKNOWN           = legacy default; demoted here when no current_rank

CREATE INDEX IF NOT EXISTS idx_tennis_players_active_tour
  ON tennis_players(tour, active_state, current_rank);

UPDATE tennis_players
SET active_state = 'RANKED_ACTIVE',
    updated_at = datetime('now')
WHERE current_rank IS NOT NULL
  AND current_rank > 0;

UPDATE tennis_players
SET active_state = 'LIBRARY_INACTIVE',
    updated_at = datetime('now')
WHERE (current_rank IS NULL OR current_rank <= 0)
  AND active_state IN ('UNKNOWN', 'KNOWN_UNRANKED', 'LIBRARY_INACTIVE');

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0107_tennis_active_ranked_library', datetime('now'));
