/** Active/ranked tennis library membership.
 * Historical rows stay in D1 for provenance; product surfaces prefer RANKED_ACTIVE.
 */
export const TENNIS_LIBRARY_ACTIVE_STATE = "RANKED_ACTIVE";
export const TENNIS_LIBRARY_INACTIVE_STATE = "LIBRARY_INACTIVE";

export function isTennisLibraryActive(row) {
  if (!row) return false;
  if (String(row.active_state || "") === TENNIS_LIBRARY_ACTIVE_STATE) return true;
  const rank = Number(row.current_rank);
  return Number.isFinite(rank) && rank > 0;
}

/** SQL fragment: prefer ranked-active rows when resolving by normalized name. */
export const TENNIS_LIBRARY_ACTIVE_ORDER =
  "CASE WHEN active_state='RANKED_ACTIVE' THEN 0 WHEN current_rank IS NOT NULL AND current_rank>0 THEN 1 ELSE 2 END, current_rank ASC";
