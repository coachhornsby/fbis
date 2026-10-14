/**
 * Read-only SportsDataverse → FBIS CFB board join.
 * This snapshot is retrospective source intelligence, NOT historical PIT evidence.
 * Exact ESPN identities only. Never create a model input or betting authority.
 */
const num = v => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
export function cfbBoardEspnId(side = {}) {
  const inputs = [side.espnId, side.providerTeamId, side.canonicalId, side.id];
  for (const value of inputs) {
    const raw = String(value ?? "").trim();
    const match = /^(?:cfb:espn:)?([0-9]{1,12})$/.exec(raw);
    if (match) return match[1];
  }
  return null;
}
const unavailable = state => ({ state, home: null, away: null, source: null, canQualify: false, canAuthorizeWager: false, canInfluenceProjection: false });
function sideSummary(team) {
  if (!team) return null;
  const stats = team.stats || {};
  return {
    teamId: team.teamId, name: team.name, conference: team.conference || null,
    games: num(team.games), nationalRank: num(team.rank), offenseRank: num(team.offenseRank),
    defenseRank: num(team.defenseRank), record: team.record || null,
    netAdjEpa: num(stats.net_adj_epa), offAdjEpa: num(stats.adj_off_epa),
    defAdjEpa: num(stats.adj_def_epa), offenseSuccess: num(stats.success_off),
    defenseSuccess: num(stats.success_def), havocDefense: num(stats.havoc_def),
    passingOffenseEpa: num(stats.EPAplay_off_pass),
    passingDefenseEpa: num(stats.EPAplay_def_pass),
    rushingOffenseEpa: num(stats.EPAplay_off_rush),
    rushingDefenseEpa: num(stats.EPAplay_def_rush),
    pointsPerOpportunityOffense: num(stats.pts_per_opp_off),
    pointsPerOpportunityDefense: num(stats.pts_per_opp_def),
    availableMetrics: num(team.availableMetrics), missingMetrics: num(team.missingMetrics),
  };
}
export function cfbBoardSeasonEvidence(game, intelligence) {
  if (game?.sport !== "cfb") return unavailable("NOT_CFB");
  if (!intelligence?.ok || intelligence?.season !== 2026 || !Array.isArray(intelligence.teams)
      || !intelligence.source?.sha256 || !intelligence.source?.observedAt) return unavailable("SOURCE_UNAVAILABLE");
  const homeId = cfbBoardEspnId(game.home);
  const awayId = cfbBoardEspnId(game.away);
  if (!homeId || !awayId || homeId === awayId) return unavailable("IDENTITY_UNRESOLVED");
  const ids = new Map(intelligence.teams.map(t => [String(t.espnId), t]));
  const home = ids.get(homeId), away = ids.get(awayId);
  if (!home || !away || home.teamId !== `cfb:espn:${homeId}` || away.teamId !== `cfb:espn:${awayId}`)
    return unavailable("IDENTITY_UNRESOLVED");
  return {
    state: home.games > 0 && away.games > 0 ? "SOURCE_OBSERVED" : "INSUFFICIENT_SOURCE_GAMES",
    home: sideSummary(home), away: sideSummary(away),
    source: {label:"SportsDataverse FBS team summaries", observedAt: intelligence.source.observedAt,
      providerPublicationAt: intelligence.source.providerPublicationAt || null,
      sha256: intelligence.source.sha256, version: intelligence.version},
    role: "RETROSPECTIVE_DISPLAY_ONLY", canQualify: false, canAuthorizeWager: false,
    canInfluenceProjection: false, historicalPitVerified: false,
  };
}
