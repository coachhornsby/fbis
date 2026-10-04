/**
 * Canonical data-lineage and deduplication policy.
 *
 * A transport/library is not automatically an independent source. SportsDataverse
 * often exposes the same upstream providers FBIS already consumes directly.
 * Lineage families prevent the same fact from becoming multiple model features.
 */

export const LINEAGE_FAMILIES = Object.freeze({
  cfbd: { authority: "cfbd", aliases: ["cfbd", "cfbfastR-cfbd", "sportsdataverse-cfbd"] },
  espn: { authority: "espn_public", aliases: ["espn_public", "sportsdataverse-espn", "hoopR-espn", "wehoop-espn", "cfbfastR-espn"] },
  ncaa: { authority: "ncaa", aliases: ["ncaa", "sportsdataverse-ncaa", "cfbfastR-ncaa", "hoopR-ncaa", "wehoop-ncaa"] },
  nflverse: { authority: "nflverse", aliases: ["nflverse", "nflfastR", "sportsdataverse-nflverse"] },
  nfl_ngs: { authority: "nfl_ngs", aliases: ["nfl_ngs", "sportsdataverse-nfl-ngs"] },
  mlb_stats: { authority: "mlb_stats_api", aliases: ["mlb_stats_api", "baseballr-mlb-api", "sportsdataverse-mlb-api"] },
  statcast: { authority: "baseball_savant", aliases: ["baseball_savant", "baseballr-statcast", "sportsdataverse-statcast"] },
  nhl_web: { authority: "nhl_web", aliases: ["nhl_web", "fastRhockey-nhl", "sportsdataverse-nhl-web"] },
  nhl_edge: { authority: "nhl_edge", aliases: ["nhl_edge", "sportsdataverse-nhl-edge"] },
  nba_stats: { authority: "nba_stats", aliases: ["nba_stats", "hoopR-nba-stats", "sportsdataverse-nba-stats"] },
  wnba_stats: { authority: "wnba_stats", aliases: ["wnba_stats", "wehoop-wnba-stats", "sportsdataverse-wnba-stats"] },
  theodds: { authority: "theodds", aliases: ["theodds", "oddsapiR", "sportsdataverse-odds-theodds"] },
});

const ALIAS_TO_LINEAGE = new Map(
  Object.entries(LINEAGE_FAMILIES).flatMap(([lineage, cfg]) =>
    cfg.aliases.map((alias) => [String(alias).toLowerCase(), lineage])
  )
);

export function resolveLineage(source) {
  const key = String(source || "").trim().toLowerCase();
  return ALIAS_TO_LINEAGE.get(key) || key || null;
}

export function sameLineage(a, b) {
  const aa = resolveLineage(a);
  const bb = resolveLineage(b);
  return Boolean(aa && bb && aa === bb);
}

function ts(row) {
  const raw = row?.observedAt || row?.observed_at || row?.retrievedAt || row?.retrieved_at || null;
  const n = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(n) ? n : -Infinity;
}

function completeness(row) {
  if (Number.isFinite(Number(row?.completeness))) return Number(row.completeness);
  const v = row?.value;
  if (v == null) return 0;
  if (typeof v !== "object") return 1;
  const vals = Object.values(v);
  return vals.length ? vals.filter((x) => x != null && x !== "").length / vals.length : 0;
}

/**
 * Collapse observations that represent the same canonical fact and upstream lineage.
 * Independent upstream lineages are retained for validation/disagreement analysis.
 */
export function dedupeCanonicalObservations(rows = []) {
  const best = new Map();
  for (const row of rows || []) {
    const lineage = resolveLineage(row?.source || row?.providerId);
    const factKey = String(row?.canonicalKey || row?.featureKey || row?.field || "").trim();
    const entityKey = String(row?.entityId || row?.gameId || row?.playerId || row?.teamId || "").trim();
    const cutoff = String(row?.dataThrough || row?.data_through || row?.effectiveAt || "").trim();
    if (!lineage || !factKey) continue;
    const key = [factKey, entityKey, cutoff, lineage].join("|");
    const prev = best.get(key);
    if (!prev || completeness(row) > completeness(prev) || (completeness(row) === completeness(prev) && ts(row) > ts(prev))) {
      best.set(key, { ...row, lineage });
    }
  }
  return [...best.values()];
}

export const SPORTSDATAVERSE_INCREMENTAL_CATALOG = Object.freeze([
  { sport: "nfl", family: "next_gen_stats", lineage: "nfl_ngs", decision: "ADD", role: "tracking/features", duplicateOf: null },
  { sport: "nfl", family: "nflverse", lineage: "nflverse", decision: "SKIP_DUPLICATE", role: "validation/fallback", duplicateOf: "nflverse" },
  { sport: "cfb", family: "cfbd_pbp", lineage: "cfbd", decision: "SKIP_DUPLICATE", role: "validation/fallback", duplicateOf: "cfbd" },
  { sport: "cfb", family: "ncaa_pbp_box", lineage: "ncaa", decision: "ADD", role: "incremental/historical", duplicateOf: null },
  { sport: "cbb", family: "ncaa_pbp_lineups_stints", lineage: "ncaa", decision: "ADD", role: "incremental/historical", duplicateOf: null },
  { sport: "cbb", family: "espn", lineage: "espn", decision: "SKIP_DUPLICATE", role: "validation/fallback", duplicateOf: "espn_public" },
  { sport: "mlb", family: "mlb_stats_api", lineage: "mlb_stats", decision: "SKIP_DUPLICATE", role: "validation/fallback", duplicateOf: "mlb_stats_api" },
  { sport: "mlb", family: "statcast", lineage: "statcast", decision: "SKIP_DUPLICATE", role: "validation/fallback", duplicateOf: "baseball_savant" },
  { sport: "nhl", family: "nhl_game_feed", lineage: "nhl_web", decision: "ADD", role: "pbp/game-state", duplicateOf: null },
  { sport: "nhl", family: "nhl_edge", lineage: "nhl_edge", decision: "ADD", role: "tracking/features", duplicateOf: null },
  { sport: "wnba", family: "wnba_stats", lineage: "wnba_stats", decision: "ADD", role: "pbp/box/player", duplicateOf: null },
  { sport: "nba", family: "nba_stats", lineage: "nba_stats", decision: "LICENSE_REVIEW", role: "research-only-until-cleared", duplicateOf: null },
  { sport: "soccer", family: "espn_leagues", lineage: "espn", decision: "ADD_IF_MISSING", role: "schedule/box/pbp", duplicateOf: null },
  { sport: "all", family: "the_odds_api", lineage: "theodds", decision: "SKIP_DUPLICATE", role: "historical-utility-only", duplicateOf: "theodds" },
]);

export function incrementalCatalog({ sport = null } = {}) {
  const s = sport ? String(sport).toLowerCase() : null;
  return SPORTSDATAVERSE_INCREMENTAL_CATALOG.filter((row) => !s || row.sport === s || row.sport === "all");
}
