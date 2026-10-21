export const CFB_STAFF_ROLES = Object.freeze({
  HEAD_COACH: "HEAD_COACH",
  OFFENSIVE_COORDINATOR: "OFFENSIVE_COORDINATOR",
  DEFENSIVE_COORDINATOR: "DEFENSIVE_COORDINATOR",
  OFFENSIVE_PLAY_CALLER: "OFFENSIVE_PLAY_CALLER",
  DEFENSIVE_PLAY_CALLER: "DEFENSIVE_PLAY_CALLER",
});

export function normalizeStaffAlias(value = "") {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function buildCfbdStaffId(providerId) {
  const id = String(providerId ?? "").trim();
  return id ? `cfb:cfbd-staff:${id}` : null;
}

export function staffRoleAt(assignments = [], teamId, role, season, at = null) {
  return assignments.find((row) => {
    if (!row || row.team_id !== teamId || row.role !== role || Number(row.season) !== Number(season)) return false;
    if (!at) return true;
    if (!row.pit_resolvable) return false;
    const t = new Date(at).getTime();
    const from = row.effective_from ? new Date(row.effective_from).getTime() : null;
    const to = row.effective_to ? new Date(row.effective_to).getTime() : null;
    return from != null && Number.isFinite(t) && t >= from && (to == null || t < to);
  }) || null;
}

export function explicitPlayCallerAt(assignments = [], teamId, side, season, at = null) {
  const role = String(side).toLowerCase() === "offense"
    ? CFB_STAFF_ROLES.OFFENSIVE_PLAY_CALLER
    : String(side).toLowerCase() === "defense"
      ? CFB_STAFF_ROLES.DEFENSIVE_PLAY_CALLER : null;
  return role ? staffRoleAt(assignments, teamId, role, season, at) : null;
}

export function coachStatePermission(governance) {
  return Boolean(governance)
    && Number(governance.can_influence_projection) === 1
    && Number(governance.can_qualify) === 1
    && Number(governance.can_authorize_wager) === 1;
}
