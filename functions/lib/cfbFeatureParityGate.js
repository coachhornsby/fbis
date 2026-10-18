/**
 * CI / research-validation gate: team-statistics surface feature availability
 * must not silently diverge from projection-engine feature availability for
 * eligible upcoming FBS games.
 */

import { resolvePersistedGamesPlayed } from "./cfbDeepFeed.js";

const CRITICAL_PROJECTION_FIELDS = Object.freeze([
  "offensePpa",
  "defensePpa",
  "gamesPlayed",
]);

const SNAPSHOT_TO_ENGINE = Object.freeze({
  ppaOff: "offensePpa",
  ppaDef: "defensePpa",
  ppaPass: "passEpa",
  ppaRush: "rushEpa",
  ppaPassAllowed: "passEpaAllowed",
  ppaRushAllowed: "rushEpaAllowed",
  offensiveSuccessRate: "successRate",
  defensiveSuccessRate: "successRateAllowed",
});

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function snapshotFieldsToEngineShape(features = {}) {
  const out = {};
  for (const [src, dst] of Object.entries(SNAPSHOT_TO_ENGINE)) {
    const v = num(features[src]);
    if (v != null) out[dst] = v;
  }
  const gp = resolvePersistedGamesPlayed(features);
  if (gp != null) out.gamesPlayed = gp;
  out.coreThroughWeek = num(features.coreThroughWeek);
  out.coreWeekBounded = features.coreWeekBounded === true;
  return out;
}

/**
 * Compare page-visible snapshot fields vs engine-consumed deep-feed fields
 * for one team. Significant discrepancies return fail diagnostics.
 */
export function compareTeamFeatureParity({
  teamId,
  pageFeatures = null,
  engineFeatures = null,
  critical = CRITICAL_PROJECTION_FIELDS,
} = {}) {
  const page = snapshotFieldsToEngineShape(pageFeatures || {});
  const engine = engineFeatures || {};
  const discrepancies = [];

  for (const field of critical) {
    const p = field === "gamesPlayed" ? num(page.gamesPlayed) : num(page[field]);
    const e = num(engine[field]);
    if (p != null && e == null) {
      discrepancies.push({
        field,
        severity: "fail",
        reason: "page-has-value-engine-missing",
        page: p,
        engine: e,
      });
    } else if (p == null && e != null) {
      discrepancies.push({
        field,
        severity: "warn",
        reason: "engine-has-value-page-missing",
        page: p,
        engine: e,
      });
    } else if (p != null && e != null && Math.abs(p - e) > 1e-6) {
      discrepancies.push({
        field,
        severity: "fail",
        reason: "value-mismatch",
        page: p,
        engine: e,
      });
    }
  }

  // Prior-only trap: page shows current PPA but engine gamesPlayed stayed 0.
  if (num(page.offensePpa) != null && !(num(engine.gamesPlayed) > 0) && num(page.gamesPlayed) > 0) {
    discrepancies.push({
      field: "gamesPlayed",
      severity: "fail",
      reason: "current-ppa-ignored-zero-games-played",
      page: page.gamesPlayed,
      engine: engine.gamesPlayed ?? 0,
    });
  }

  const fails = discrepancies.filter((d) => d.severity === "fail");
  return {
    teamId,
    ok: fails.length === 0,
    discrepancies,
    failCount: fails.length,
    pageShape: page,
    engineShape: {
      offensePpa: num(engine.offensePpa),
      defensePpa: num(engine.defensePpa),
      gamesPlayed: num(engine.gamesPlayed),
    },
  };
}

/**
 * Gate a slate of upcoming games. Any significant team discrepancy fails the
 * research-validation gate (visible diagnostic; caller decides hard-fail).
 */
export function runFeatureParityGate({ games = [], pageByEspnId = {}, engineByEspnId = {} } = {}) {
  const results = [];
  for (const game of games) {
    for (const side of ["home", "away"]) {
      const team = game?.[side] || {};
      const espnId = String(team.espnId || team.id || "").replace(/^cfb:espn:|^cfb-/, "");
      if (!espnId) continue;
      const cmp = compareTeamFeatureParity({
        teamId: espnId,
        pageFeatures: pageByEspnId[espnId] || null,
        engineFeatures: engineByEspnId[espnId] || game?.cfbDeepInput?.[side] || null,
      });
      results.push({ gameId: String(game.id || ""), side, ...cmp });
    }
  }
  const failures = results.filter((r) => !r.ok);
  return {
    ok: failures.length === 0,
    checked: results.length,
    failCount: failures.length,
    failures: failures.slice(0, 50),
    results,
    gate: "cfb-feature-parity-page-vs-engine",
    authority: "research-validation",
  };
}
