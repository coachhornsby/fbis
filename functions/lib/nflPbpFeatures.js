/**
 * Deterministic NFL play-by-play feature transforms (manual feature families).
 * Consumes PIT-filtered canonical plays from nflPbpNormalize.js.
 * Does not invent coefficients.
 */

import { filterPlaysByInformationCutoff } from "./nflPbpNormalize.js";

/** Feature families this module actually computes from PBP. */
export const NFL_COMPUTED_FROM_PBP = Object.freeze([
  "historical_pbp",
  "epa",
  "success_rate",
  "early_down_efficiency",
  "passing_down_efficiency",
  "rush_pass_splits",
  "explosiveness",
  "pressure_sacks",
  "turnovers_regression",
  "red_zone",
  "pace",
]);

/** Declared in NFL_FEATURE_PIPELINE but not computed here. */
export const NFL_DECLARED_NOT_COMPUTED = Object.freeze([
  "field_position",
  "special_teams",
  "rosters",
  "qb_identity_value",
  "injuries_practice_status",
  "active_inactive",
  "coaching_context",
  "venue_roof_surface",
  "weather",
  "rest_travel",
  "schedule_game_identity",
]);

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rate(n, d) {
  if (!d) return null;
  return n / d;
}

function isNoPlay(p) {
  return String(p.playType || "").toLowerCase() === "no_play";
}

/**
 * Team offense/defense aggregates from a PIT play window.
 * Canonical play fields: posteam, defteam, playType, epa, success, …
 */
export function computeTeamPbpFeatures(plays, team) {
  const t = String(team || "").toUpperCase();
  const off = plays.filter((p) => p.posteam === t && !isNoPlay(p));
  const def = plays.filter((p) => p.defteam === t && !isNoPlay(p));
  const offEpa = off.map((p) => p.epa).filter((x) => Number.isFinite(x));
  const defEpa = def.map((p) => p.epa).filter((x) => Number.isFinite(x));
  const successOff = off.filter((p) => p.success === 1).length;
  const early = off.filter((p) => p.earlyDown === 1);
  const passDown = off.filter((p) => p.passingDown === 1);
  const rush = off.filter((p) => p.rush === 1 || p.playType === "run");
  const pass = off.filter((p) => p.pass === 1 || p.playType === "pass");
  const explosive = off.filter((p) => p.explosive === 1).length;
  const sacksAllowed = off.filter((p) => p.sack === 1).length;
  const sacksForced = def.filter((p) => p.sack === 1).length;
  const toOff = off.filter((p) => p.turnover === 1).length;
  const toDef = def.filter((p) => p.turnover === 1).length;
  const rzOff = off.filter((p) => p.redZone === 1);
  const rzSuccess = rzOff.filter((p) => p.success === 1).length;
  const games = new Set(off.map((p) => p.gameId));
  const playsPerGame = games.size ? off.length / games.size : null;

  return {
    team: t,
    play_count_off: off.length,
    play_count_def: def.length,
    games_observed: games.size,
    epa_offense_mean: mean(offEpa),
    epa_defense_mean: mean(defEpa),
    success_rate_offense: rate(successOff, off.length),
    early_down_success: rate(early.filter((p) => p.success === 1).length, early.length),
    passing_down_success: rate(passDown.filter((p) => p.success === 1).length, passDown.length),
    rush_rate: rate(rush.length, off.length),
    pass_rate: rate(pass.length, off.length),
    explosive_rate: rate(explosive, off.length),
    sack_rate_allowed: rate(sacksAllowed, Math.max(pass.length, 1)),
    sack_rate_forced: rate(sacksForced, Math.max(def.filter((p) => p.pass === 1 || p.playType === "pass").length, 1)),
    turnover_rate_offense: rate(toOff, off.length),
    turnover_rate_defense: rate(toDef, def.length),
    red_zone_success: rate(rzSuccess, rzOff.length),
    pace_plays_per_game: playsPerGame,
  };
}

/**
 * Matchup feature vector for research projection / replay training.
 * Missingness: null features when either team has fewer than minPlays.
 */
export function buildMatchupFeatureSnapshot({
  plays,
  homeTeam,
  awayTeam,
  informationCutoff,
  minPlays = 40,
} = {}) {
  const pit = filterPlaysByInformationCutoff(plays, informationCutoff);
  if (!pit.ok) {
    return {
      ok: false,
      reason: pit.reason,
      features: null,
      missingness: null,
    };
  }
  const window = pit.plays;
  const home = computeTeamPbpFeatures(window, homeTeam);
  const away = computeTeamPbpFeatures(window, awayTeam);
  const homeOk = home.play_count_off >= minPlays;
  const awayOk = away.play_count_off >= minPlays;

  const features = {
    historical_pbp: window.length > 0,
    epa_diff:
      homeOk && awayOk
        ? (Number(home.epa_offense_mean) || 0) -
          (Number(away.epa_offense_mean) || 0) -
          ((Number(home.epa_defense_mean) || 0) - (Number(away.epa_defense_mean) || 0))
        : null,
    success_diff:
      homeOk && awayOk
        ? (Number(home.success_rate_offense) || 0) - (Number(away.success_rate_offense) || 0)
        : null,
    early_down_diff:
      homeOk && awayOk
        ? (Number(home.early_down_success) || 0) - (Number(away.early_down_success) || 0)
        : null,
    passing_down_diff:
      homeOk && awayOk
        ? (Number(home.passing_down_success) || 0) - (Number(away.passing_down_success) || 0)
        : null,
    rush_pass_home_rush_rate: homeOk ? home.rush_rate : null,
    explosive_diff:
      homeOk && awayOk
        ? (Number(home.explosive_rate) || 0) - (Number(away.explosive_rate) || 0)
        : null,
    pressure_sack_diff:
      homeOk && awayOk
        ? (Number(home.sack_rate_forced) || 0) -
          (Number(away.sack_rate_forced) || 0) -
          ((Number(home.sack_rate_allowed) || 0) - (Number(away.sack_rate_allowed) || 0))
        : null,
    turnover_diff:
      homeOk && awayOk
        ? (Number(away.turnover_rate_offense) || 0) -
          (Number(home.turnover_rate_offense) || 0) +
          ((Number(home.turnover_rate_defense) || 0) - (Number(away.turnover_rate_defense) || 0))
        : null,
    red_zone_diff:
      homeOk && awayOk
        ? (Number(home.red_zone_success) || 0) - (Number(away.red_zone_success) || 0)
        : null,
    pace_diff:
      homeOk && awayOk
        ? (Number(home.pace_plays_per_game) || 0) - (Number(away.pace_plays_per_game) || 0)
        : null,
  };

  return {
    ok: true,
    informationCutoff: informationCutoff || null,
    excludedFutureCount: pit.excludedFutureCount,
    home,
    away,
    features,
    missingness: {
      policy: "null_when_below_min_plays",
      minPlays,
      homeOk,
      awayOk,
      declared_not_computed: [...NFL_DECLARED_NOT_COMPUTED],
    },
    computed_feature_families: [...NFL_COMPUTED_FROM_PBP],
  };
}

export function featureStatusMap() {
  const out = {};
  for (const k of NFL_COMPUTED_FROM_PBP) {
    out[k] = {
      status: "IMPLEMENTED_RESEARCH_ONLY",
      sourceAdapter: "nflfastR/nflverse-shaped PBP (normalizeNflPbpPlay)",
      rawStorage: "caller-supplied play rows / optional D1 nfl_pbp_raw",
      module: "functions/lib/nflPbpFeatures.js",
      consumedBy: "NFL-FBIS-PURE research pipeline when featureSnapshot provided",
    };
  }
  for (const k of NFL_DECLARED_NOT_COMPUTED) {
    out[k] = {
      status: "IMPLEMENTATION_PENDING",
      sourceAdapter: null,
      rawStorage: null,
      module: null,
      note: "Declared name only — no adapter, PIT transform, registry consumption, or test",
    };
  }
  return out;
}
