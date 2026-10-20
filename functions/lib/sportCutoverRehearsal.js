/**
 * Single-sport cutover rehearsal (offline / in-process only).
 * Never mutates deployed SPORT_DB_MODE_* env vars.
 * Proves: board-output comparison, rollback to PRIMARY, fail paths.
 */
import {
  productSportDbHandle,
  isSportDbAuthoritative,
  SPORT_DATABASES,
  deployedSportDbMode,
} from "./databaseTopology.js";
import { buildCrossSportBoardSummary } from "./coreBoardSummaries.js";

export const CUTOVER_REHEARSAL_CONTRACT = "fbis-sport-cutover-rehearsal-v1";

function cloneEnv(env) {
  return { ...env };
}

/**
 * Build a synthetic env for rehearsal. Does not touch live Cloudflare config.
 */
export function buildRehearsalEnv(baseEnv, sport, {
  mode = "shadow",
  dropSportBinding = false,
  dropCore = false,
  partialSportData = false,
} = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const env = cloneEnv(baseEnv || {});
  const modeKey = key === "nhl" ? "NHL_SPORT_DB_MODE" : `SPORT_DB_MODE_${key.toUpperCase()}`;
  env[modeKey] = mode;
  env[`SPORT_DB_MODE_${key.toUpperCase()}`] = mode;
  if (key === "nhl") env.NHL_SPORT_DB_MODE = mode;

  if (dropSportBinding && plan?.binding) {
    delete env[plan.binding];
  }
  if (dropCore) {
    delete env.CORE_DB;
  }
  if (partialSportData && plan?.binding && env[plan.binding]) {
    env.__rehearsalPartialSport = true;
  }
  return env;
}

/**
 * Capture a minimal board fingerprint from a product handle + optional summary.
 */
export async function captureBoardFingerprint(env, sport, { label = "primary" } = {}) {
  const product = productSportDbHandle(env, sport);
  const db = product.db;
  let gameIds = [];
  let projectionIds = [];
  if (db?.prepare) {
    try {
      const games = await db.prepare(
        `SELECT id FROM games WHERE sport=? ORDER BY id ASC LIMIT 50`
      ).bind(sport).all();
      gameIds = (games.results || []).map((r) => r.id);
    } catch {
      gameIds = [];
    }
    try {
      const preds = await db.prepare(
        `SELECT id FROM prediction_snapshots WHERE sport=? ORDER BY id ASC LIMIT 50`
      ).bind(sport).all();
      projectionIds = (preds.results || []).map((r) => r.id);
    } catch {
      projectionIds = [];
    }
  }
  return {
    label,
    sport,
    binding: product.binding,
    mode: product.mode,
    productIoUsesSportDb: product.productIoUsesSportDb === true,
    reason: product.reason,
    gameIds,
    projectionIds,
    gameCount: gameIds.length,
    projectionCount: projectionIds.length,
  };
}

function fingerprintsMatch(a, b) {
  if (!a || !b) return false;
  if (a.gameIds.length !== b.gameIds.length) return false;
  if (a.projectionIds.length !== b.projectionIds.length) return false;
  for (let i = 0; i < a.gameIds.length; i += 1) {
    if (a.gameIds[i] !== b.gameIds[i]) return false;
  }
  for (let i = 0; i < a.projectionIds.length; i += 1) {
    if (a.projectionIds[i] !== b.projectionIds[i]) return false;
  }
  return true;
}

/**
 * Rehearse a single-sport switch with rollback.
 * Always returns canAuthorizeWager:false and never recommends live cutover.
 */
export async function rehearseSportCutover(env, sport, {
  injectMissingBinding = false,
  injectPartialSport = false,
  injectStaleCore = false,
} = {}) {
  const key = String(sport || "").toLowerCase();
  if (!SPORT_DATABASES[key]) {
    return {
      ok: false,
      contract: CUTOVER_REHEARSAL_CONTRACT,
      reason: "UNKNOWN_SPORT",
      sport: key,
      liveCutoverAuthorized: false,
      canAuthorizeWager: false,
    };
  }

  const deployedMode = deployedSportDbMode(env, key);
  const baseline = await captureBoardFingerprint(env, key, { label: "deployed_baseline" });

  // Shadow still on PRIMARY
  const shadowEnv = buildRehearsalEnv(env, key, { mode: "shadow" });
  const shadowFp = await captureBoardFingerprint(shadowEnv, key, { label: "shadow_rehearsal" });
  const shadowStaysPrimary = shadowFp.productIoUsesSportDb === false && shadowFp.binding === "DB";

  // Simulated sport mode (in-process only — does not mutate live env)
  const sportEnv = buildRehearsalEnv(env, key, {
    mode: "sport",
    dropSportBinding: injectMissingBinding,
    partialSportData: injectPartialSport,
  });
  const sportFp = await captureBoardFingerprint(sportEnv, key, { label: "sport_rehearsal" });
  const sportWouldActivate = !injectMissingBinding
    && sportFp.productIoUsesSportDb === true
    && sportFp.binding === SPORT_DATABASES[key].binding;

  // Rollback: revert rehearsal env to shadow and confirm PRIMARY again
  const rollbackEnv = buildRehearsalEnv(sportEnv, key, { mode: "shadow" });
  const rollbackFp = await captureBoardFingerprint(rollbackEnv, key, { label: "rollback_shadow" });
  const rollbackOk = rollbackFp.productIoUsesSportDb === false
    && rollbackFp.binding === "DB"
    && fingerprintsMatch(baseline, rollbackFp);

  // Caller override must not bypass shadow on the deployed-mode baseline
  const overrideRejected = productSportDbHandle(shadowEnv, key, { mode: "sport" });
  const overrideBlocked = overrideRejected.productIoUsesSportDb === false
    && overrideRejected.reason === "CALLER_MODE_OVERRIDE_REJECTED_ENV_AUTHORITY";

  // CORE completeness under rehearsal
  const coreSports = {};
  for (const s of Object.keys(SPORT_DATABASES)) {
    coreSports[s] = s === key && injectStaleCore
      ? { complete: false, reason: "STALE_CORE_INJECTED" }
      : { gameCount: 1, projectionCount: 1, complete: true, authority: "PRIMARY" };
  }
  const coreSummary = buildCrossSportBoardSummary({ sports: coreSports, sourceBinding: "CORE_DB" });
  const coreFailClosed = injectStaleCore ? coreSummary.complete === false : coreSummary.complete === true;

  const steps = [
    { step: "baseline_primary", ok: baseline.productIoUsesSportDb === false, fingerprint: baseline },
    { step: "shadow_stays_primary", ok: shadowStaysPrimary, fingerprint: shadowFp },
    { step: "caller_mode_override_blocked", ok: overrideBlocked, reason: overrideRejected.reason },
    {
      step: "simulated_sport_switch",
      ok: injectMissingBinding ? sportFp.productIoUsesSportDb === false : sportWouldActivate,
      fingerprint: sportFp,
      injectedMissingBinding: injectMissingBinding,
    },
    { step: "rollback_to_shadow", ok: rollbackOk, fingerprint: rollbackFp },
    {
      step: "core_summary_fail_closed",
      ok: coreFailClosed,
      coreComplete: coreSummary.complete,
      incompleteSports: coreSummary.incompleteSports,
    },
  ];

  const ok = steps.every((s) => s.ok === true);
  return {
    ok,
    contract: CUTOVER_REHEARSAL_CONTRACT,
    sport: key,
    deployedMode,
    deployedStillAuthoritative: !isSportDbAuthoritative(env, key),
    steps,
    boardComparison: {
      baselineVsRollback: fingerprintsMatch(baseline, rollbackFp),
      shadowUsesPrimary: shadowStaysPrimary,
    },
    liveCutoverAuthorized: false,
    productionCutoverBlocked: true,
    note: "Rehearsal only — primary D1 remains authoritative; do not set SPORT_DB_MODE_*=sport.",
    canAuthorizeWager: false,
  };
}
