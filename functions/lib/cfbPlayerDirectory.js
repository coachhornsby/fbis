/**
 * CFB persistent player directory Phase B.
 * Identity/roster context only. FBIS-STATE-OVERLAY-v1 research governance.
 */
export const CFB_PLAYER_DIRECTORY_VERSION = "cfb-directory-phase-b-v1";

export function normalizePlayerAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[^a-z0-9\s]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

export function buildCanonicalPlayerId({provider, providerPlayerId, fallbackKey}) {
  if (provider && providerPlayerId != null && String(providerPlayerId).trim()) {
    return `cfb:${normalizePlayerAlias(provider).replace(/\s+/g,"-")}-player:${String(providerPlayerId).trim()}`;
  }
  if (fallbackKey && String(fallbackKey).trim()) {
    return `cfb:provisional:${String(fallbackKey).trim()}`;
  }
  throw new Error("player identity requires stable provider ID or explicit provisional key");
}

export function membershipAt(memberships = [], playerId, at) {
  const t=Date.parse(at || "");
  if (!Number.isFinite(t)) return [];
  return memberships
    .filter(r=>String(r.player_id)===String(playerId))
    .filter(r=>{
      const from=Date.parse(r.effective_from || "");
      const to=Date.parse(r.effective_to || "");
      return Number.isFinite(from) && Number.isFinite(to) && from <= t && t < to;
    })
    .sort((a,b)=>Date.parse(b.effective_from)-Date.parse(a.effective_from));
}

export function rosterAt(memberships = [], teamId, at) {
  const t=Date.parse(at || "");
  if (!Number.isFinite(t)) return [];
  return memberships
    .filter(r=>String(r.team_id)===String(teamId))
    .filter(r=>{
      const from=Date.parse(r.effective_from || "");
      const to=Date.parse(r.effective_to || "");
      return Number.isFinite(from) && Number.isFinite(to) && from <= t && t < to;
    });
}

export function playerAt(players = [], memberships = [], playerId, at) {
  const player=players.find(p=>String(p.player_id)===String(playerId)) || null;
  if (!player) return null;
  return {player,memberships:membershipAt(memberships,playerId,at)};
}

export function rosterStatePermission() {
  return {
    overlayVersion:"FBIS-STATE-OVERLAY-v1",
    researchOnly:true,
    canInfluenceProjection:false,
    canQualify:false,
    canAuthorizeWager:false
  };
}
