/**
 * NFL independent shadow baseline v0.
 *
 * This is deliberately not the production NFL champion. It creates a real,
 * market-independent OOS series from team scoring form while the richer EPA /
 * success-rate / QB / trench stack is built. It can never qualify wagers.
 */

import { loadTeamForm } from "./store.js";
import { pGreater } from "./metrics.js";

export const NFL_SHADOW_ID = "NFL-TEAM-FORM-v0";
export const NFL_CONSTANTS = {
  leaguePpg: 22.5,
  hfa: 1.5,
  priorGames: 8,
  marginSigma: 13.5,
  totalSigma: 12.5,
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(v) { return Math.round(Number(v) * 10) / 10; }

export function nflSeasonYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
}

function formRow(map, team) {
  if (!map?.get || !team) return null;
  const candidates = [
    team.espnId != null ? `id:${team.espnId}` : null,
    team.abbr ? `abbr:${String(team.abbr).toUpperCase()}` : null,
    team.name ? `name:${String(team.name).toLowerCase()}` : null,
    team.school ? `name:${String(team.school).toLowerCase()}` : null,
  ].filter(Boolean);
  for (const key of candidates) {
    const hit = map.get(key);
    if (hit) return hit;
  }
  return null;
}

function rates(row) {
  const games = num(row?.games) || 0;
  if (!games) return null;
  const pf = num(row?.pointsFor ?? row?.points_for);
  const pa = num(row?.pointsAgainst ?? row?.points_against);
  if (pf == null || pa == null) return null;
  return { games, off: pf / games, def: pa / games };
}

function blend(prior, current, n) {
  if (current == null) return prior;
  const w = Math.max(0, Number(n) || 0) / (Math.max(0, Number(n) || 0) + NFL_CONSTANTS.priorGames);
  return prior * (1 - w) + current * w;
}

export function projectNflFormV0(game, { homePrior = null, awayPrior = null, homeCurrent = null, awayCurrent = null } = {}) {
  const hp = rates(homePrior);
  const ap = rates(awayPrior);
  const hc = rates(homeCurrent);
  const ac = rates(awayCurrent);
  const homeEvidence = hp || hc;
  const awayEvidence = ap || ac;
  if (!homeEvidence || !awayEvidence) {
    return { modelId: NFL_SHADOW_ID, ok: false, reason: "team-specific-form-prior-missing", independent: true, marketInformed: false, canQualify: false };
  }
  const homeOffPrior = hp?.off ?? NFL_CONSTANTS.leaguePpg;
  const homeDefPrior = hp?.def ?? NFL_CONSTANTS.leaguePpg;
  const awayOffPrior = ap?.off ?? NFL_CONSTANTS.leaguePpg;
  const awayDefPrior = ap?.def ?? NFL_CONSTANTS.leaguePpg;
  const homeOff = blend(homeOffPrior, hc?.off, hc?.games || 0);
  const homeDef = blend(homeDefPrior, hc?.def, hc?.games || 0);
  const awayOff = blend(awayOffPrior, ac?.off, ac?.games || 0);
  const awayDef = blend(awayDefPrior, ac?.def, ac?.games || 0);
  const hfa = game?.neutralSite ? 0 : NFL_CONSTANTS.hfa;
  const home = round1(homeOff + (awayDef - NFL_CONSTANTS.leaguePpg) + hfa / 2);
  const away = round1(awayOff + (homeDef - NFL_CONSTANTS.leaguePpg) - hfa / 2);
  const margin = round1(home - away);
  const total = round1(home + away);
  return {
    modelId: NFL_SHADOW_ID,
    version: "v0",
    role: "shadow",
    family: "baseline",
    ok: true,
    home,
    away,
    margin,
    total,
    pHomeWin: pGreater(margin, 0, NFL_CONSTANTS.marginSigma),
    sigmaMargin: NFL_CONSTANTS.marginSigma,
    sigmaTotal: NFL_CONSTANTS.totalSigma,
    independent: true,
    marketInformed: false,
    canQualify: false,
    featuresOk: true,
    provenance: {
      prior: "previous-season harvested team scoring form",
      current: "current-season harvested team scoring form",
      marketUsed: false,
      hfa,
    },
  };
}

export async function attachNflShadow(games = [], env = {}) {
  const season = nflSeasonYear();
  const [prior, current] = await Promise.all([
    loadTeamForm(env, "nfl", season - 1).catch(() => new Map()),
    loadTeamForm(env, "nfl", season).catch(() => new Map()),
  ]);
  let available = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "nfl") return game;
    const projection = projectNflFormV0(game, {
      homePrior: formRow(prior, game.home),
      awayPrior: formRow(prior, game.away),
      homeCurrent: formRow(current, game.home),
      awayCurrent: formRow(current, game.away),
    });
    if (projection.ok) available += 1;
    return {
      ...game,
      challengers: { ...(game.challengers || {}), [NFL_SHADOW_ID]: projection },
      nflShadow: projection,
    };
  });
  return {
    games: next,
    meta: {
      modelId: NFL_SHADOW_ID,
      role: "shadow",
      season,
      games: next.length,
      available,
      qualificationAllowed: false,
      note: "Independent scoring-form baseline for OOS collection only. Production NFL qualification remains blocked until a validated professional-football model is promoted.",
    },
  };
}
