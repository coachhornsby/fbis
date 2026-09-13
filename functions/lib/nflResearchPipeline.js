/**
 * NFL research pipeline: PBP → features → transparent OLS fit → freeze → grade → walk-forward.
 *
 * No fabricated coefficients. Coefficients come only from historical fold fits.
 * Status: IMPLEMENTED_RESEARCH_ONLY for machinery; OOS_DATA_PENDING only after
 * the full path exists and future graded N is the sole remaining dependency.
 *
 * Does not auto-qualify or authorize.
 */

import { createHash } from "node:crypto";
import { normalizeNflPbpPlays } from "./nflPbpNormalize.js";
import { buildMatchupFeatureSnapshot, NFL_COMPUTED_FROM_PBP } from "./nflPbpFeatures.js";
import { gradeScores } from "./collegeJobsCore.js";
import { MODEL_FAMILY, MODEL_MATURITY } from "./canonical/maturityStates.js";

export const NFL_RESEARCH_MODEL_ID = "NFL-FBIS-PURE";
export const NFL_RESEARCH_MODEL_VERSION = "pbp-ols-research-v0";

export const NFL_FEATURE_KEYS = Object.freeze([
  "epa_diff",
  "success_diff",
  "early_down_diff",
  "passing_down_diff",
  "rush_pass_home_rush_rate",
  "explosive_diff",
  "pressure_sack_diff",
  "turnover_diff",
  "red_zone_diff",
  "pace_diff",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hashObj(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 40);
}

function featureVector(features = {}) {
  return NFL_FEATURE_KEYS.map((k) => num(features[k]));
}

function vectorComplete(vec) {
  return vec.every((x) => x != null);
}

/**
 * Ordinary least squares for y ~ [1, x...] (Gaussian elimination).
 * Returns null if singular / underdetermined.
 */
export function fitOlsMargin(rows = []) {
  const usable = rows.filter((r) => vectorComplete(featureVector(r.features)) && num(r.actualMargin) != null);
  const p = NFL_FEATURE_KEYS.length + 1;
  if (usable.length < p) {
    return { ok: false, reason: "insufficient-rows-for-ols", n: usable.length, required: p };
  }

  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);
  for (const row of usable) {
    const x = [1, ...featureVector(row.features)];
    const y = num(row.actualMargin);
    for (let i = 0; i < p; i++) {
      xty[i] += x[i] * y;
      for (let j = 0; j < p; j++) xtx[i][j] += x[i] * x[j];
    }
  }

  const a = xtx.map((row, i) => [...row, xty[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    if (Math.abs(a[piv][col]) < 1e-12) {
      return { ok: false, reason: "singular-design-matrix", n: usable.length };
    }
    if (piv !== col) {
      const tmp = a[col];
      a[col] = a[piv];
      a[piv] = tmp;
    }
    const div = a[col][col];
    for (let j = col; j <= p; j++) a[col][j] /= div;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = col; j <= p; j++) a[r][j] -= f * a[col][j];
    }
  }

  const beta = a.map((row) => row[p]);
  const intercept = beta[0];
  const coefficients = {};
  NFL_FEATURE_KEYS.forEach((k, i) => {
    coefficients[k] = beta[i + 1];
  });

  return {
    ok: true,
    n: usable.length,
    intercept,
    coefficients,
    featureKeys: [...NFL_FEATURE_KEYS],
    trainingHash: hashObj({ intercept, coefficients, n: usable.length }),
  };
}

export function projectMarginFromFit(fit, features) {
  if (!fit?.ok) return { ok: false, reason: fit?.reason || "no-fit" };
  const vec = featureVector(features);
  if (!vectorComplete(vec)) return { ok: false, reason: "incomplete-features" };
  let margin = fit.intercept;
  NFL_FEATURE_KEYS.forEach((k, i) => {
    margin += fit.coefficients[k] * vec[i];
  });
  // Transparent score split: league-ish total prior 44.5, split by margin.
  const totalPrior = 44.5;
  const home = totalPrior / 2 + margin / 2;
  const away = totalPrior / 2 - margin / 2;
  return {
    ok: true,
    projectedMargin: margin,
    projectedHome: home,
    projectedAway: away,
    projectedTotal: home + away,
    fitRef: fit.trainingHash,
  };
}

/**
 * Build feature snapshot from raw nflfastR-shaped rows.
 */
export function buildNflResearchFeatureSnapshot({
  rawPlays = [],
  homeTeam,
  awayTeam,
  informationCutoff,
  minPlays = 40,
} = {}) {
  const { plays, rejected } = normalizeNflPbpPlays(rawPlays);
  const snap = buildMatchupFeatureSnapshot({
    plays,
    homeTeam,
    awayTeam,
    informationCutoff,
    minPlays,
  });
  return {
    ...snap,
    normalizedPlayCount: plays.length,
    rejectedPlayCount: rejected.length,
    computedFamilies: [...NFL_COMPUTED_FROM_PBP],
  };
}

/**
 * Immutable freeze of a research projection (in-memory contract).
 * Persistence can use collegeStore.insertModelPrediction with this payload.
 */
export function freezeNflResearchProjection({
  eventId,
  homeTeam,
  awayTeam,
  projection,
  featureSnapshot,
  informationCutoff,
  modelVersion = NFL_RESEARCH_MODEL_VERSION,
  frozenAt = new Date().toISOString(),
} = {}) {
  if (!projection?.ok) {
    return { ok: false, reason: projection?.reason || "no-projection" };
  }
  const payload = {
    modelId: NFL_RESEARCH_MODEL_ID,
    modelVersion,
    role: "shadow",
    sport: "nfl",
    eventId: String(eventId || ""),
    homeTeam,
    awayTeam,
    projHome: projection.projectedHome,
    projAway: projection.projectedAway,
    projMargin: projection.projectedMargin,
    projTotal: projection.projectedTotal,
    featureSnapshotId: featureSnapshot?.id || hashObj(featureSnapshot?.features || {}),
    informationCutoff: informationCutoff || featureSnapshot?.informationCutoff || null,
    fitRef: projection.fitRef || null,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    family: MODEL_FAMILY.PURE,
    maturity: MODEL_MATURITY.RESEARCH,
    frozenAt,
  };
  const contentHash = hashObj({
    eventId: payload.eventId,
    modelVersion,
    projHome: payload.projHome,
    projAway: payload.projAway,
    cutoff: payload.informationCutoff,
    fitRef: payload.fitRef,
  });
  return {
    ok: true,
    immutable: true,
    id: `nfl:${payload.eventId}:${NFL_RESEARCH_MODEL_ID}:${payload.informationCutoff || "na"}`,
    contentHash,
    ...payload,
  };
}

export function gradeNflResearchProjection(frozen, actualHome, actualAway) {
  if (!frozen?.ok && frozen?.projHome == null) {
    return { ok: false, reason: "missing-frozen-projection" };
  }
  const grade = gradeScores(
    {
      projHome: frozen.projHome,
      projAway: frozen.projAway,
    },
    actualHome,
    actualAway
  );
  if (!grade.ok) return { ok: false, reason: "grade-inputs-invalid" };
  return {
    ok: true,
    frozenId: frozen.id,
    contentHash: frozen.contentHash,
    actualHome: Number(actualHome),
    actualAway: Number(actualAway),
    ...grade,
    gradedAt: new Date().toISOString(),
  };
}

/**
 * Expanding walk-forward: for each fold i (after burn-in), fit on 0..i-1, predict i.
 * rows: [{ eventId, week, features, actualMargin, actualHome, actualAway, homeTeam, awayTeam, informationCutoff }]
 */
export function runNflWalkForward(rows = [], { burnIn = null } = {}) {
  const sorted = [...rows].sort((a, b) => {
    const wa = num(a.week) ?? 0;
    const wb = num(b.week) ?? 0;
    if (wa !== wb) return wa - wb;
    return String(a.eventId || "").localeCompare(String(b.eventId || ""));
  });
  const p = NFL_FEATURE_KEYS.length + 1;
  const minTrain = burnIn != null ? burnIn : p;
  const folds = [];
  const frozen = [];
  const graded = [];

  for (let i = minTrain; i < sorted.length; i++) {
    const train = sorted.slice(0, i);
    const test = sorted[i];
    const fit = fitOlsMargin(train);
    if (!fit.ok) {
      folds.push({ index: i, eventId: test.eventId, ok: false, reason: fit.reason });
      continue;
    }
    const proj = projectMarginFromFit(fit, test.features);
    if (!proj.ok) {
      folds.push({ index: i, eventId: test.eventId, ok: false, reason: proj.reason });
      continue;
    }
    const fr = freezeNflResearchProjection({
      eventId: test.eventId,
      homeTeam: test.homeTeam,
      awayTeam: test.awayTeam,
      projection: proj,
      featureSnapshot: { features: test.features, informationCutoff: test.informationCutoff },
      informationCutoff: test.informationCutoff,
      frozenAt: test.informationCutoff || new Date().toISOString(),
    });
    const gr = gradeNflResearchProjection(fr, test.actualHome, test.actualAway);
    folds.push({
      index: i,
      eventId: test.eventId,
      ok: true,
      trainingN: fit.n,
      trainingHash: fit.trainingHash,
      projectedMargin: proj.projectedMargin,
      actualMargin: test.actualMargin,
      errMargin: gr.errMargin,
    });
    frozen.push(fr);
    graded.push(gr);
  }

  const absErr = graded.map((g) => Math.abs(g.errMargin)).filter((x) => Number.isFinite(x));
  const maeMargin = absErr.length
    ? absErr.reduce((a, b) => a + b, 0) / absErr.length
    : null;

  return {
    ok: true,
    modelId: NFL_RESEARCH_MODEL_ID,
    modelVersion: NFL_RESEARCH_MODEL_VERSION,
    foldScheme: "expanding_walk_forward",
    rowCount: sorted.length,
    foldCount: folds.filter((f) => f.ok).length,
    maeMargin,
    folds,
    frozen,
    graded,
    status: {
      machinery: "IMPLEMENTED_RESEARCH_ONLY",
      oosStatus: graded.length > 0 ? "VALIDATION_PENDING" : "IMPLEMENTATION_PENDING",
      note:
        graded.length > 0
          ? "Historical replay walk-forward operational on supplied rows; production OOS accumulation and operator promotion still required"
          : "Insufficient complete feature+label rows for walk-forward",
      canQualify: false,
    },
  };
}

export function nflResearchPipelineStatus() {
  return {
    modelId: NFL_RESEARCH_MODEL_ID,
    modelVersion: NFL_RESEARCH_MODEL_VERSION,
    adapters: {
      pbpNormalize: "functions/lib/nflPbpNormalize.js",
      pbpFeatures: "functions/lib/nflPbpFeatures.js",
      researchPipeline: "functions/lib/nflResearchPipeline.js",
      teamFormFallback: "functions/lib/nflModel.js (NFL-TEAM-FORM-v0) — NOT the pure manual model",
    },
    computedFeatureFamilies: [...NFL_COMPUTED_FROM_PBP],
    walkForward: "IMPLEMENTED_RESEARCH_ONLY",
    freeze: "IMPLEMENTED_RESEARCH_ONLY",
    grade: "IMPLEMENTED_RESEARCH_ONLY",
    autoFreezeInProductionJobs: false,
    autoGradeInProductionJobs: false,
    canQualify: false,
  };
}
