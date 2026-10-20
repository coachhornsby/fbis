/**
 * Single-sport cutover rehearsal (offline / in-process only).
 * Never mutates deployed SPORT_DB_MODE_* env vars.
 * Compares board-relevant projection fields primary vs simulated sport,
 * exercises partial-data omission, and proves rollback.
 */
import {
  productSportDbHandle,
  isSportDbAuthoritative,
  SPORT_DATABASES,
  deployedSportDbMode,
} from "./databaseTopology.js";
import { buildCrossSportBoardSummary } from "./coreBoardSummaries.js";
import { evaluateSportPredictionFidelity } from "./canonicalEvidenceContract.js";

export const CUTOVER_REHEARSAL_CONTRACT = "fbis-sport-cutover-rehearsal-v2";

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
  issueCutoverReceipt = false,
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
  if (issueCutoverReceipt) {
    env[`SPORT_CUTOVER_RECEIPT_${key.toUpperCase()}`] = `rehearsal-${key}-receipt`;
  } else {
    delete env[`SPORT_CUTOVER_RECEIPT_${key.toUpperCase()}`];
  }
  if (partialSportData && plan?.binding && env[plan.binding]) {
    env.__rehearsalPartialSport = true;
    // Wrap sport DB so prediction reads omit evidence fields / drop half the rows.
    const real = env[plan.binding];
    env[plan.binding] = {
      prepare(sql) {
        const stmt = real.prepare(sql);
        const s = String(sql);
        if (s.includes("FROM prediction_snapshots")) {
          return {
            bind(...args) {
              const bound = typeof stmt.bind === "function" ? stmt.bind(...args) : stmt;
              return {
                async all() {
                  const page = await bound.all();
                  const results = (page?.results || [])
                    .filter((_, i) => i % 2 === 0)
                    .map((row) => ({
                      ...row,
                      weights_json: null,
                      layers_json: null,
                      payload_json: null,
                      graded_at: null,
                      deployment_commit: null,
                    }));
                  return { ...page, results };
                },
                async first() {
                  const row = await bound.first();
                  if (!row) return null;
                  return {
                    ...row,
                    weights_json: null,
                    layers_json: null,
                    payload_json: null,
                  };
                },
              };
            },
            async all() { return this.bind().all(); },
            async first() { return this.bind().first(); },
          };
        }
        return stmt;
      },
    };
  }
  return env;
}

/**
 * Capture board-relevant fingerprint including projection field samples.
 */
export async function captureBoardFingerprint(env, sport, {
  label = "primary",
  sampleSize = 50,
} = {}) {
  const product = productSportDbHandle(env, sport);
  const db = product.db;
  const limit = Math.min(200, Math.max(5, Number(sampleSize) || 50));
  let games = [];
  let projections = [];
  if (db?.prepare) {
    try {
      const page = await db.prepare(
        `SELECT id,start,home_name,away_name,home_abbr,away_abbr
         FROM games WHERE sport=? ORDER BY id ASC LIMIT ?`
      ).bind(sport, limit).all();
      games = page?.results || [];
    } catch {
      games = [];
    }
    try {
      const page = await db.prepare(
        `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,
                proj_margin,p_home_final,p_market,frozen_at,weights_json,layers_json,
                projection_flags,graded_at,deployment_commit,payload_json
         FROM prediction_snapshots WHERE sport=? ORDER BY id ASC LIMIT ?`
      ).bind(sport, limit).all();
      projections = page?.results || [];
    } catch {
      try {
        const page = await db.prepare(
          `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
           FROM prediction_snapshots WHERE sport=? ORDER BY id ASC LIMIT ?`
        ).bind(sport, limit).all();
        projections = page?.results || [];
      } catch {
        projections = [];
      }
    }
  }

  const fidelity = projections.map((p) => evaluateSportPredictionFidelity(p, { requireEnvelope: Boolean(p.payload_json) }));
  const fidelityOk = fidelity.filter((f) => f.ok).length;

  return {
    label,
    sport,
    binding: product.binding,
    mode: product.mode,
    productIoUsesSportDb: product.productIoUsesSportDb === true,
    reason: product.reason,
    gameIds: games.map((g) => g.id),
    projectionIds: projections.map((p) => p.id),
    games,
    projections,
    gameCount: games.length,
    projectionCount: projections.length,
    fidelityOk,
    fidelitySampled: fidelity.length,
  };
}

function numEq(a, b) {
  if (a == null && b == null) return true;
  const x = Number(a); const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
}

function projectionFieldsMatch(a, b) {
  if (!a || !b) return false;
  return String(a.id) === String(b.id)
    && String(a.game_id || "") === String(b.game_id || "")
    && String(a.frozen_at || "") === String(b.frozen_at || "")
    && String(a.model_version || "") === String(b.model_version || "")
    && numEq(a.proj_total, b.proj_total)
    && numEq(a.proj_home, b.proj_home)
    && numEq(a.proj_away, b.proj_away)
    && numEq(a.p_home_final, b.p_home_final)
    && String(a.weights_json || "") === String(b.weights_json || "")
    && String(a.layers_json || "") === String(b.layers_json || "")
    && String(a.deployment_commit || "") === String(b.deployment_commit || "");
}

export function compareBoardFingerprints(baseline, candidate) {
  const gameIdMatch = baseline.gameIds.length === candidate.gameIds.length
    && baseline.gameIds.every((id, i) => id === candidate.gameIds[i]);
  const byId = new Map(candidate.projections.map((p) => [p.id, p]));
  let matched = 0;
  const mismatches = [];
  for (const p of baseline.projections) {
    const c = byId.get(p.id);
    if (projectionFieldsMatch(p, c)) matched += 1;
    else mismatches.push({ id: p.id, status: c ? "DIVERGED" : "MISSING" });
  }
  const complete = gameIdMatch
    && baseline.projections.length > 0
    && matched === baseline.projections.length
    && candidate.projectionCount === baseline.projectionCount;
  return {
    ok: complete,
    gameIdMatch,
    projectionMatched: matched,
    projectionSampled: baseline.projections.length,
    mismatches: mismatches.slice(0, 20),
    candidateFidelityOk: candidate.fidelityOk,
    candidateFidelitySampled: candidate.fidelitySampled,
  };
}

function fingerprintsMatchIds(a, b) {
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
 * Rehearse a single-sport switch with rollback and field-level comparison.
 * Always returns canAuthorizeWager:false and never recommends live cutover.
 */
export async function rehearseSportCutover(env, sport, {
  injectMissingBinding = false,
  injectPartialSport = false,
  injectStaleCore = false,
  sampleSize = 50,
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
  const baseline = await captureBoardFingerprint(env, key, { label: "deployed_baseline", sampleSize });

  const shadowEnv = buildRehearsalEnv(env, key, { mode: "shadow" });
  const shadowFp = await captureBoardFingerprint(shadowEnv, key, { label: "shadow_rehearsal", sampleSize });
  const shadowStaysPrimary = shadowFp.productIoUsesSportDb === false && shadowFp.binding === "DB";

  // Sport mode without receipt must stay on PRIMARY.
  const sportNoReceipt = buildRehearsalEnv(env, key, {
    mode: "sport",
    dropSportBinding: injectMissingBinding,
    issueCutoverReceipt: false,
  });
  const noReceiptFp = await captureBoardFingerprint(sportNoReceipt, key, { label: "sport_without_receipt", sampleSize });
  const receiptRequired = noReceiptFp.productIoUsesSportDb === false
    && (injectMissingBinding || /RECEIPT|UNBOUND|GUARD|PRIMARY/i.test(noReceiptFp.reason || ""));

  // Simulated sport mode WITH receipt (in-process only)
  const sportEnv = buildRehearsalEnv(env, key, {
    mode: "sport",
    dropSportBinding: injectMissingBinding,
    partialSportData: injectPartialSport,
    issueCutoverReceipt: !injectMissingBinding,
  });
  const sportFp = await captureBoardFingerprint(sportEnv, key, { label: "sport_rehearsal", sampleSize });
  const sportWouldActivate = !injectMissingBinding
    && sportFp.productIoUsesSportDb === true
    && sportFp.binding === SPORT_DATABASES[key].binding;

  const outputCompare = (!injectMissingBinding && !injectPartialSport && sportWouldActivate)
    ? compareBoardFingerprints(baseline, sportFp)
    : { ok: false, skipped: true, reason: injectPartialSport ? "PARTIAL_INJECTED" : injectMissingBinding ? "BINDING_MISSING" : "SPORT_NOT_ACTIVE" };

  // Partial injection must fail field comparison / fidelity.
  let partialDetected = true;
  if (injectPartialSport && sportWouldActivate) {
    const partialCompare = compareBoardFingerprints(baseline, sportFp);
    partialDetected = partialCompare.ok === false
      || sportFp.fidelityOk < sportFp.fidelitySampled
      || sportFp.projectionCount < baseline.projectionCount;
  }

  // Rollback
  const rollbackEnv = buildRehearsalEnv(sportEnv, key, { mode: "shadow", issueCutoverReceipt: false });
  const rollbackFp = await captureBoardFingerprint(rollbackEnv, key, { label: "rollback_shadow", sampleSize });
  const rollbackOk = rollbackFp.productIoUsesSportDb === false
    && rollbackFp.binding === "DB"
    && fingerprintsMatchIds(baseline, rollbackFp);

  const overrideRejected = productSportDbHandle(shadowEnv, key, { mode: "sport" });
  const overrideBlocked = overrideRejected.productIoUsesSportDb === false
    && overrideRejected.reason === "CALLER_MODE_OVERRIDE_REJECTED_ENV_AUTHORITY";

  const coreSports = {};
  for (const s of Object.keys(SPORT_DATABASES)) {
    coreSports[s] = s === key && injectStaleCore
      ? { complete: false, reason: "STALE_CORE_INJECTED" }
      : { gameCount: 1, projectionCount: 1, complete: true, authority: "PRIMARY" };
  }
  const coreSummary = buildCrossSportBoardSummary({ sports: coreSports, sourceBinding: "CORE_DB" });
  const coreFailClosed = injectStaleCore ? coreSummary.complete === false : coreSummary.complete === true;

  const steps = [
    { step: "baseline_primary", ok: baseline.productIoUsesSportDb === false, fingerprint: summarizeFp(baseline) },
    { step: "shadow_stays_primary", ok: shadowStaysPrimary, fingerprint: summarizeFp(shadowFp) },
    { step: "caller_mode_override_blocked", ok: overrideBlocked, reason: overrideRejected.reason },
    { step: "sport_mode_requires_cutover_receipt", ok: receiptRequired, fingerprint: summarizeFp(noReceiptFp) },
    {
      step: "simulated_sport_switch",
      ok: injectMissingBinding ? sportFp.productIoUsesSportDb === false : sportWouldActivate,
      fingerprint: summarizeFp(sportFp),
      injectedMissingBinding: injectMissingBinding,
    },
    {
      step: "baseline_vs_sport_output_compare",
      ok: injectPartialSport || injectMissingBinding ? true : outputCompare.ok === true,
      comparison: outputCompare,
    },
    {
      step: "partial_data_injection_detected",
      ok: partialDetected,
      injected: injectPartialSport,
    },
    { step: "rollback_to_shadow", ok: rollbackOk, fingerprint: summarizeFp(rollbackFp) },
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
      baselineVsRollback: fingerprintsMatchIds(baseline, rollbackFp),
      baselineVsSport: outputCompare,
      shadowUsesPrimary: shadowStaysPrimary,
    },
    liveCutoverAuthorized: false,
    productionCutoverBlocked: true,
    note: "Rehearsal only — primary D1 remains authoritative; do not set SPORT_DB_MODE_*=sport.",
    canAuthorizeWager: false,
  };
}

function summarizeFp(fp) {
  return {
    label: fp.label,
    binding: fp.binding,
    mode: fp.mode,
    productIoUsesSportDb: fp.productIoUsesSportDb,
    reason: fp.reason,
    gameCount: fp.gameCount,
    projectionCount: fp.projectionCount,
    fidelityOk: fp.fidelityOk,
    fidelitySampled: fp.fidelitySampled,
  };
}
