import directory from "../../data/soccer-team-branding.js";

// Presentation metadata only. Never changes model identity or predictive inputs.
export function soccerBrandKey(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(fc|cf|sc|afc|football club)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}
const hex = value => /^[0-9a-f]{6}$/i.test(String(value || "")) ? `#${value}` : null;
export function resolveSoccerBrand(team = {}, league = "", source = directory) {
  const keys = [team.fullName, team.displayName, team.name].filter(Boolean).map(soccerBrandKey);
  const scoped = source.leagues?.[league] || [];
  const all = Object.values(source.leagues || {}).flat();
  const match = rows => {
    const hits = rows.filter(row => [row.displayName, row.name, row.shortDisplayName, row.location]
      .filter(Boolean).some(name => keys.includes(soccerBrandKey(name))));
    const ids = new Set(hits.map(row => String(row.id)));
    return ids.size === 1 ? hits[0] : null;
  };
  // Exact names only, with competition-scoped identity preferred. No substring matches.
  const hit = match(scoped) || match(all);
  if (!hit) return null;
  const logo = hit.logos?.find(row => /^https:\/\//.test(row.href || ""))?.href || null;
  return { logo, abbr: hit.abbreviation || null, color: hex(hit.color), altColor: hex(hit.alternateColor),
    brandingEspnId: String(hit.id), brandingSource: source.source, brandingObservedAt: source.observedAt };
}
export function attachSoccerTeamBranding(games = []) {
  return games.map(game => {
    const enrich = team => {
      const brand = resolveSoccerBrand(team, game.soccerLeague || game.league);
      return { ...team, sport: "soccer", ...(brand ? {
        ...brand, logo: team?.logo || brand.logo,
        abbr: team?.abbr && team.abbr !== "—" ? team.abbr : brand.abbr || "—",
        color: team?.color || brand.color, altColor: team?.altColor || brand.altColor,
      } : {}) };
    };
    return { ...game, home: enrich(game.home), away: enrich(game.away) };
  });
}
