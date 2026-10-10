/**
 * FBS-vs-FBS player-card scope. Read-only team identity lookup.
 * Unknown or missing subdivision MUST NOT be treated as FBS.
 */
const text = (v) => String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function annotateCfbFbsMatchups(games = [], fbsTeams = []) {
  const ids = new Set();
  const schools = new Set();
  for (const row of fbsTeams) {
    if (String(row.subdivision || "FBS").toUpperCase() !== "FBS") continue;
    if (row.team_id) ids.add(String(row.team_id));
    if (row.school_name) schools.add(text(row.school_name));
  }
  const isFbs = (team = {}) => {
    const id = team.espnId != null ? `cfb:espn:${team.espnId}` : null;
    if (id) return ids.has(id);
    // Exact canonical school-name fallback only; never fuzzy aliases.
    const name = text(team.school || team.name || team.fullName);
    return Boolean(name && schools.has(name));
  };
  return games.map((game) => {
    const homeFbs = isFbs(game.home);
    const awayFbs = isFbs(game.away);
    return { ...game, cfbFbsMatchup: homeFbs && awayFbs,
      cfbFbsScope: homeFbs && awayFbs ? "FBS_V_FBS" : "OUT_OF_SCOPE_OR_UNVERIFIED" };
  });
}

export async function loadCfbFbsTeams(env = {}) {
  if (!env.DB?.prepare) return { teams: [], error: "canonical-directory-unavailable" };
  try {
    const result = await env.DB.prepare(
      "SELECT team_id, school_name, subdivision FROM cfb_canonical_teams WHERE subdivision='FBS' AND active=1"
    ).all();
    return { teams: result?.results || [], error: null };
  } catch (err) {
    return { teams: [], error: String(err?.message || err) };
  }
}
