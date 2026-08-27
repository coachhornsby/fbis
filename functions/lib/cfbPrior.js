/**
 * Frozen CFB team-specific prior.
 * v1: ESPN FPI (all FBS) + opponent-adjusted SRS from 2025 ESPN finals.
 * v2: CollegeFootballData SP+/FPI/SRS/Elo (runtime, cfb-prior-v2-cfbd) with v1 fallback.
 */

import PRIOR from "../../data/cfb/prior-v1.js";
import { resolveTeam } from "./teams.js";

export const CFB_PRIOR_VERSION_V1 = PRIOR.version || "cfb-prior-v1";
export const CFB_PRIOR_VERSION_CFBD = "cfb-prior-v2-cfbd";
export const CFB_PRIOR_VERSION = CFB_PRIOR_VERSION_V1;

export const CFB_PRIOR_META = {
  version: PRIOR.version,
  season: PRIOR.season,
  methodology: PRIOR.methodology,
  source: PRIOR.source,
  hfa: PRIOR.hfa,
  leaguePpg: PRIOR.leaguePpg,
  nGames: PRIOR.nGames,
  nTeams: PRIOR.nTeams,
  builtAt: PRIOR.builtAt,
};

export function cfbPriorCatalog() {
  return PRIOR;
}

function lookupIn(source, team) {
  if (!source || !team) return null;
  const id = team.espnId != null ? String(team.espnId) : null;
  if (id && source.byEspnId?.[id]) return source.byEspnId[id];
  const hit = resolveTeam("cfb", team);
  if (hit?.espnId && source.byEspnId?.[String(hit.espnId)]) return source.byEspnId[String(hit.espnId)];
  const school = String(team.school || team.name || hit?.school || "")
    .trim()
    .toLowerCase();
  if (school && source.bySchool?.[school]) return source.bySchool[school];
  return null;
}

export function priorForTeam(team, catalog) {
  if (!team) return null;
  const fromCatalog = lookupIn(catalog, team);
  if (fromCatalog) return fromCatalog;
  if (catalog && catalog !== PRIOR) {
    const fallback = lookupIn(PRIOR, team);
    if (fallback) return fallback;
  }
  return lookupIn(PRIOR, team);
}

/** True when the prior is team-specific, not a generic league-average fill. */
export function hasTeamSpecificPrior(row) {
  if (!row) return false;
  if (row.sp != null && Number.isFinite(Number(row.sp))) return true;
  if (row.fpi != null && Number.isFinite(Number(row.fpi))) return true;
  if (row.srs != null && Number.isFinite(Number(row.srs))) return true;
  if (row.elo != null && Number.isFinite(Number(row.elo))) return true;
  if (Number.isFinite(Number(row.off)) && Number.isFinite(Number(row.def)) && String(row.source || "").startsWith("cfbd")) return true;
  if (row.provisional && row.fpi == null && row.srs == null && row.sp == null && row.elo == null) return false;
  if ((row.n || 0) >= 4 && (row.off != null || row.def != null)) return true;
  return false;
}

export function freezePrior(row, meta = {}) {
  if (!row) return null;
  return {
    version: row.version || meta.version || CFB_PRIOR_VERSION,
    espnId: row.espnId,
    abbr: row.abbr,
    school: row.school,
    n: row.n,
    fpi: row.fpi ?? null,
    srs: row.srs ?? null,
    sp: row.sp ?? null,
    elo: row.elo ?? null,
    talent: row.talent ?? null,
    returningPct: row.returningPct ?? null,
    off: row.off,
    def: row.def,
    source: row.source,
    asOf: row.asOf || meta.asOf || null,
    year: row.year || meta.year || null,
    provisional: Boolean(row.provisional),
    newlyPromoted: Boolean(row.newlyPromoted),
    classification: row.classification || null,
  };
}
