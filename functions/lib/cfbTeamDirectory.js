/**
 * CFB persistent team directory Phase A.
 * Identity/conference context only. FBIS-STATE-OVERLAY-v1 research governance.
 */
export const CFB_STATE_OVERLAY_VERSION = "FBIS-STATE-OVERLAY-v1";
export const CFB_DIRECTORY_VERSION = "cfb-directory-phase-a-v1";

export function normalizeTeamAlias(value) {
  return String(value || "").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}

export function conferenceAt(memberships = [], teamId, at) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return null;
  const rows = memberships.filter(r => String(r.team_id) === String(teamId)).filter(r => {
    const from=Date.parse(r.effective_from||"");
    const to=r.effective_to ? Date.parse(r.effective_to) : Infinity;
    return Number.isFinite(from) && from <= t && t < to;
  }).sort((a,b)=>Date.parse(b.effective_from)-Date.parse(a.effective_from));
  return rows[0] || null;
}

export function buildCanonicalTeamId({provider, providerTeamId, schoolName}) {
  if (provider && providerTeamId != null && String(providerTeamId).trim()) {
    return `cfb:${normalizeTeamAlias(provider)}:${String(providerTeamId).trim()}`;
  }
  const alias=normalizeTeamAlias(schoolName);
  if (!alias) throw new Error("team identity requires provider ID or school name");
  return `cfb:unresolved:${alias.replace(/\s+/g,"-")}`;
}

export function stateOverlayPermission() {
  return {overlayVersion:CFB_STATE_OVERLAY_VERSION,researchOnly:true,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false};
}


/**
 * Fail-closed selector for the current production FBS model universe.
 * Canonical row existence alone never establishes production eligibility.
 */
export function isCurrentFbsTeam(team) {
  return Boolean(team)
    && (team.active === 1 || team.active === true)
    && String(team.subdivision || "").toUpperCase() === "FBS";
}

export function currentFbsUniverse(teams = []) {
  return teams.filter(isCurrentFbsTeam);
}

/**
 * Point-in-time subdivision/classification comes from temporal membership,
 * not the canonical team's current classification.
 */
export function subdivisionAt(memberships = [], teamId, at) {
  const row=conferenceAt(memberships,teamId,at);
  if (!row) return null;
  const subdivision=String(row.subdivision || "").trim().toUpperCase();
  return subdivision || null;
}

export function isFbsAt(memberships = [], teamId, at) {
  return subdivisionAt(memberships,teamId,at) === "FBS";
}
