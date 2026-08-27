/**
 * Frozen CFB team-specific prior (cfb-prior-v1).
 * ESPN FPI (all FBS) + opponent-adjusted SRS from 2025 ESPN finals.
 */

import PRIOR from "../../data/cfb/prior-v1.js";
import { resolveTeam } from "./teams.js";

export const CFB_PRIOR_VERSION = PRIOR.version || "cfb-prior-v1";
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

export function priorForTeam(team) {
  if (!team) return null;
  const id = team.espnId != null ? String(team.espnId) : null;
  if (id && PRIOR.byEspnId?.[id]) return PRIOR.byEspnId[id];
  const hit = resolveTeam("cfb", team);
  if (hit?.espnId && PRIOR.byEspnId?.[String(hit.espnId)]) return PRIOR.byEspnId[String(hit.espnId)];
  return null;
}

/** True when the prior is team-specific, not a generic league-average fill. */
export function hasTeamSpecificPrior(row) {
  if (!row) return false;
  if (row.provisional && row.fpi == null && row.srs == null) return false;
  if (row.fpi != null && Number.isFinite(Number(row.fpi))) return true;
  if (row.srs != null && Number.isFinite(Number(row.srs))) return true;
  if ((row.n || 0) >= 4 && (row.off != null || row.def != null)) return true;
  return false;
}

export function freezePrior(row) {
  if (!row) return null;
  return {
    version: CFB_PRIOR_VERSION,
    espnId: row.espnId,
    abbr: row.abbr,
    school: row.school,
    n: row.n,
    fpi: row.fpi,
    srs: row.srs,
    off: row.off,
    def: row.def,
    source: row.source,
    provisional: Boolean(row.provisional),
    classification: row.classification,
  };
}
