/**
 * FBIS continuous learning governance, tiers 1-5.
 *
 * Tier 1: monitoring + drift alerts
 * Tier 2: sample-count-triggered recalibration
 * Tier 3: paired challenger evaluation with bootstrap gate
 * Tier 4: Bayesian shrinkage state for score-bias corrections
 * Tier 5: shadow-only adaptive model weighting
 *
 * Production mutation is deliberately excluded. Promotion remains manual.
 */

import { querySnapshots } from "./store.js";
import {
  selectCanonicalLearningSnapshots,
  snapshotModelId,
  snapshotMarketInformed,
  toModelLabRow,
} from "./snapshotLearning.js";

export const CONTINUOUS_LEARNING_POLICY = Object.freeze({
  minRecalibrationN: 160,
  minNewRowsForRecalibration: 50,
  minChallengerHoldoutN: 40,
  minBayesianN: 60,
  minShadowN: 30,
  recentWindowN: 50,
  bootstrapSamples: 1200,
  brierMargin: 0.001,
  logLossMargin: 0.002,
  maxEceRegression: 0.01,
  autoPromote: false,
  autoWagerAuthority: false,
  tier5ProductionEnabled: false,
});

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clampP(v) {
  return Math.max(1e-6, Math.min(1 - 1e-6, Number(v)));
}
function mean(xs = []) {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function sampleVariance(xs = []) {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return null;
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
}
function mae(xs = []) {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + Math.abs(x), 0) / v.length : null;
}
function logLoss(p, y) {
  const q = clampP(p);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}
function safeId(v, max = 72) {
  return String(v || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max) || "unknown";
}
function nowIso() { return new Date().toISOString(); }

function binaryRows(rows = []) {
  return rows.map((row) => {
    const p = finite(row.p_home_win ?? row.pHomeFinal ?? row.pHome);
    const ah = finite(row.actual_home ?? row.actualHome);
    const aa = finite(row.actual_away ?? row.actualAway);
    if (p == null || ah == null || aa == null || ah === aa) return null;
    return {
      ...row,
      p: clampP(p),
      y: ah > aa ? 1 : 0,
      frozenAt: row.frozen_at || row.frozenAt || null,
    };
  }).filter(Boolean);
}

export function probabilityMetrics(rows = []) {
  const xs = binaryRows(rows);
  if (!xs.length) return { n: 0, brier: null, logLoss: null, ece: null, bins: [] };
  const brier = mean(xs.map((r) => (r.p - r.y) ** 2));
  const ll = mean(xs.map((r) => logLoss(r.p, r.y)));
  const bins = [];
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    const bucket = xs.filter((r) => r.p >= lo && (i === 9 ? r.p <= hi : r.p < hi));
    if (!bucket.length) continue;
    bins.push({
      lo, hi, n: bucket.length,
      meanP: mean(bucket.map((r) => r.p)),
      actualRate: mean(bucket.map((r) => r.y)),
    });
  }
  const ece = bins.reduce((s, b) => s + (b.n / xs.length) * Math.abs(b.meanP - b.actualRate), 0);
  return { n: xs.length, brier, logLoss: ll, ece, bins };
}

export function scoreMetrics(rows = []) {
  const adapted = rows.map(toModelLabRow).filter((r) =>
    Number.isFinite(r.actual_home) && Number.isFinite(r.actual_away) &&
    Number.isFinite(r.proj_home) && Number.isFinite(r.proj_away)
  );
  const marginErrors = adapted.map((r) => (r.proj_margin ?? (r.proj_home - r.proj_away)) - (r.actual_home - r.actual_away));
  const totalErrors = adapted.map((r) => (r.proj_total ?? (r.proj_home + r.proj_away)) - (r.actual_home + r.actual_away));
  return {
    n: adapted.length,
    margin: { mae: mae(marginErrors), bias: mean(marginErrors), variance: sampleVariance(marginErrors) },
    total: { mae: mae(totalErrors), bias: mean(totalErrors), variance: sampleVariance(totalErrors) },
  };
}

function recentSplit(rows = [], recentN = CONTINUOUS_LEARNING_POLICY.recentWindowN) {
  const ordered = rows.slice().sort((a, b) => String(a.frozen_at || a.frozenAt || "").localeCompare(String(b.frozen_at || b.frozenAt || "")));
  const n = Math.min(recentN, ordered.length);
  return { baseline: ordered.slice(0, Math.max(0, ordered.length - n)), recent: ordered.slice(-n) };
}

export function buildMonitoringArtifact(rows = [], { sport, modelId, recentN } = {}) {
  const allProb = probabilityMetrics(rows);
  const allScore = scoreMetrics(rows);
  const { baseline, recent } = recentSplit(rows, recentN);
  const baseProb = probabilityMetrics(baseline);
  const recentProb = probabilityMetrics(recent);
  const baseScore = scoreMetrics(baseline);
  const recentScore = scoreMetrics(recent);

  const alerts = [];
  if (baseProb.n >= 50 && recentProb.n >= 30) {
    if (recentProb.brier != null && baseProb.brier != null && recentProb.brier - baseProb.brier > 0.02) alerts.push("BRIER_DRIFT");
    if (recentProb.ece != null && baseProb.ece != null && recentProb.ece - baseProb.ece > 0.03) alerts.push("CALIBRATION_DRIFT");
  }
  if (baseScore.n >= 50 && recentScore.n >= 30) {
    if (recentScore.margin.mae != null && baseScore.margin.mae != null && recentScore.margin.mae - baseScore.margin.mae > 1.5) alerts.push("MARGIN_MAE_DRIFT");
    if (recentScore.total.mae != null && baseScore.total.mae != null && recentScore.total.mae - baseScore.total.mae > 1.5) alerts.push("TOTAL_MAE_DRIFT");
  }

  return {
    tier: 1,
    sport,
    modelId,
    observedN: rows.length,
    recentN: recent.length,
    metrics: { probability: allProb, score: allScore },
    drift: {
      baseline: { probability: baseProb, score: baseScore, n: baseline.length },
      recent: { probability: recentProb, score: recentScore, n: recent.length },
    },
    alerts,
  };
}

function logit(p) {
  const q = clampP(p);
  return Math.log(q / (1 - q));
}
function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z)))); }

function fitLogistic(features, ys, { epochs = 2500, lr = 0.03, l2 = 0.01 } = {}) {
  if (!features.length) return null;
  const d = features[0].length;
  const w = Array(d).fill(0);
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < features.length; i++) {
      const x = features[i];
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * x[j];
      const err = sigmoid(z) - ys[i];
      gb += err;
      for (let j = 0; j < d; j++) gw[j] += err * x[j];
    }
    const n = features.length;
    b -= lr * gb / n;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
  }
  return { intercept: b, weights: w };
}

export function fitCalibrator(rows = [], { method = "platt" } = {}) {
  const xs = binaryRows(rows);
  if (!xs.length) return null;
  if (method === "beta") {
    const features = xs.map((r) => [Math.log(clampP(r.p)), -Math.log(1 - clampP(r.p))]);
    const fit = fitLogistic(features, xs.map((r) => r.y));
    return {
      method: "beta",
      params: fit,
      predict: (p) => sigmoid(fit.intercept + fit.weights[0] * Math.log(clampP(p)) + fit.weights[1] * -Math.log(1 - clampP(p))),
    };
  }
  const features = xs.map((r) => [logit(r.p)]);
  const fit = fitLogistic(features, xs.map((r) => r.y));
  return {
    method: "platt",
    params: fit,
    predict: (p) => sigmoid(fit.intercept + fit.weights[0] * logit(p)),
  };
}

function applyCalibrator(rows, calibrator) {
  return binaryRows(rows).map((r) => ({ ...r, p: clampP(calibrator.predict(r.p)) }));
}

function seededRng(seedText = "") {
  let h = 2166136261 >>> 0;
  for (const ch of String(seedText)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pairedBootstrapDelta(rawRows = [], calibratedRows = [], { samples = 1200, seed = "fbis" } = {}) {
  const n = Math.min(rawRows.length, calibratedRows.length);
  if (!n) return null;
  const rng = seededRng(seed);
  const deltasBrier = [];
  const deltasLogLoss = [];
  for (let s = 0; s < samples; s++) {
    let db = 0, dl = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(rng() * n);
      const a = rawRows[k], b = calibratedRows[k];
      db += (b.p - b.y) ** 2 - (a.p - a.y) ** 2;
      dl += logLoss(b.p, b.y) - logLoss(a.p, a.y);
    }
    deltasBrier.push(db / n);
    deltasLogLoss.push(dl / n);
  }
  deltasBrier.sort((a, b) => a - b);
  deltasLogLoss.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
  return {
    n,
    brier: { mean: mean(deltasBrier), ci95: [q(deltasBrier, 0.025), q(deltasBrier, 0.975)] },
    logLoss: { mean: mean(deltasLogLoss), ci95: [q(deltasLogLoss, 0.025), q(deltasLogLoss, 0.975)] },
  };
}

export function buildRecalibrationAndGate(rows = [], { sport, modelId, policy = CONTINUOUS_LEARNING_POLICY } = {}) {
  const ordered = binaryRows(rows).sort((a, b) => String(a.frozenAt || "").localeCompare(String(b.frozenAt || "")));
  if (ordered.length < policy.minRecalibrationN) {
    return { tier: 2, status: "INSUFFICIENT_DATA", n: ordered.length, minimumN: policy.minRecalibrationN };
  }
  const holdoutN = Math.max(policy.minChallengerHoldoutN, Math.floor(ordered.length * 0.25));
  const train = ordered.slice(0, ordered.length - holdoutN);
  const holdout = ordered.slice(-holdoutN);
  const method = train.length >= 500 ? "beta" : "platt";
  const calibrator = fitCalibrator(train, { method });
  const rawMetrics = probabilityMetrics(holdout);
  const calibrated = applyCalibrator(holdout, calibrator);
  const challengerMetrics = probabilityMetrics(calibrated);
  const bootstrap = pairedBootstrapDelta(holdout, calibrated, {
    samples: policy.bootstrapSamples,
    seed: `${sport}|${modelId}|${ordered.at(-1)?.frozenAt || ""}`,
  });
  const brierDelta = challengerMetrics.brier - rawMetrics.brier;
  const logLossDelta = challengerMetrics.logLoss - rawMetrics.logLoss;
  const eceDelta = challengerMetrics.ece - rawMetrics.ece;
  const passes =
    holdout.length >= policy.minChallengerHoldoutN &&
    ((brierDelta <= -policy.brierMargin && bootstrap?.brier?.ci95?.[1] < 0) ||
      (logLossDelta <= -policy.logLossMargin && bootstrap?.logLoss?.ci95?.[1] < 0)) &&
    eceDelta <= policy.maxEceRegression;

  return {
    tier: 2,
    status: "FIT",
    sport,
    modelId,
    method,
    trainN: train.length,
    holdoutN: holdout.length,
    totalN: ordered.length,
    lastObservedAt: ordered.at(-1)?.frozenAt || null,
    params: calibrator.params,
    metrics: { raw: rawMetrics, challenger: challengerMetrics },
    tier3: {
      tier: 3,
      pairedN: holdout.length,
      bootstrap,
      deltas: { brier: brierDelta, logLoss: logLossDelta, ece: eceDelta },
      gate: {
        passes,
        brierMargin: policy.brierMargin,
        logLossMargin: policy.logLossMargin,
        maxEceRegression: policy.maxEceRegression,
        manualPromotionRequired: true,
        autoPromote: false,
      },
    },
  };
}

export function bayesianBiasState(rows = [], { sport, modelId, priorSd = 3 } = {}) {
  const adapted = rows.map(toModelLabRow).filter((r) =>
    Number.isFinite(r.actual_home) && Number.isFinite(r.actual_away) &&
    Number.isFinite(r.proj_home) && Number.isFinite(r.proj_away)
  );
  const make = (target, errors) => {
    const n = errors.length;
    const obsMean = mean(errors);
    const variance = sampleVariance(errors);
    if (n < CONTINUOUS_LEARNING_POLICY.minBayesianN || obsMean == null || variance == null) {
      return { target, status: "INSUFFICIENT_DATA", observedN: n };
    }
    const priorVar = priorSd ** 2;
    // A perfectly constant residual in a finite sample is still evidence; use a
    // tiny variance floor so the posterior remains defined instead of dropping
    // an otherwise eligible cohort.
    const obsVar = Math.max(variance, 1e-6) / n;
    const posteriorVar = 1 / (1 / priorVar + 1 / obsVar);
    const posteriorMean = posteriorVar * (obsMean / obsVar);
    return {
      target,
      status: "UPDATED",
      observedN: n,
      priorMean: 0,
      priorSd,
      posteriorMean,
      posteriorSd: Math.sqrt(posteriorVar),
      recommendedCorrection: -posteriorMean,
      advisoryOnly: true,
    };
  };
  const marginErrors = adapted.map((r) => (r.proj_margin ?? (r.proj_home-r.proj_away)) - (r.actual_home-r.actual_away));
  const totalErrors = adapted.map((r) => (r.proj_total ?? (r.proj_home+r.proj_away)) - (r.actual_home+r.actual_away));
  return {
    tier: 4, sport, modelId,
    states: [make("margin_bias", marginErrors), make("total_bias", totalErrors)],
  };
}

export function shadowModelWeights(modelGroups = new Map(), { sport } = {}) {
  const rows = [];
  for (const [modelId, modelRows] of modelGroups.entries()) {
    const m = probabilityMetrics(modelRows);
    if (m.n < CONTINUOUS_LEARNING_POLICY.minShadowN || m.logLoss == null) continue;
    rows.push({ modelId, n: m.n, score: m.logLoss });
  }
  if (!rows.length) return { tier: 5, sport, status: "INSUFFICIENT_DATA", weights: [] };
  const eta = 0.5;
  const raw = rows.map((r) => ({ ...r, rawWeight: Math.exp(-eta * r.score) }));
  const z = raw.reduce((s, r) => s + r.rawWeight, 0) || 1;
  return {
    tier: 5,
    sport,
    status: "SHADOW_ONLY",
    productionEnabled: false,
    wagerAuthority: false,
    note: "Adaptive weights are research telemetry only and cannot select production models or authorize wagers.",
    weights: raw.map((r) => ({ modelId: r.modelId, n: r.n, score: r.score, weight: r.rawWeight / z })),
  };
}

async function runDb(env, sql, binds = []) {
  if (!env?.DB?.prepare) return { ok: false, reason: "d1-unbound" };
  try { await env.DB.prepare(sql).bind(...binds).run(); return { ok: true }; }
  catch (err) { return { ok: false, reason: String(err?.message || err) }; }
}
async function firstDb(env, sql, binds = []) {
  if (!env?.DB?.prepare) return null;
  try { return await env.DB.prepare(sql).bind(...binds).first(); } catch { return null; }
}

async function lastRecalibrationN(env, sport, modelId) {
  const row = await firstDb(env,
    "SELECT total_n FROM recalibration_runs WHERE sport=? AND model_id=? AND status='FIT' ORDER BY created_at DESC LIMIT 1",
    [sport, modelId]
  );
  return Number(row?.total_n || 0);
}

async function persistMonitoring(env, a) {
  const createdAt = nowIso();
  const id = `monitor:${safeId(a.sport,12)}:${safeId(a.modelId)}:${createdAt}`;
  return runDb(env,
    `INSERT OR REPLACE INTO learning_monitor_runs
      (id,sport,model_id,observed_n,recent_n,metrics_json,drift_json,alerts_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,a.sport,a.modelId,a.observedN,a.recentN,JSON.stringify(a.metrics),JSON.stringify(a.drift),JSON.stringify(a.alerts),createdAt]
  );
}

async function persistRecalibration(env, a) {
  const createdAt = nowIso();
  const id = `recal:${safeId(a.sport,12)}:${safeId(a.modelId)}:${String(a.lastObservedAt||createdAt).slice(0,10)}:${a.totalN}`;
  const r = await runDb(env,
    `INSERT OR REPLACE INTO recalibration_runs
      (id,sport,model_id,method,train_n,holdout_n,total_n,last_observed_at,params_json,metrics_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,a.sport,a.modelId,a.method,a.trainN,a.holdoutN,a.totalN,a.lastObservedAt,JSON.stringify(a.params),JSON.stringify(a.metrics),"FIT",createdAt]
  );
  return { ...r, id };
}

async function persistChallenger(env, a, recalibrationId) {
  const createdAt = nowIso();
  const id = `challenger:${safeId(a.sport,12)}:${safeId(a.modelId)}:${String(createdAt).slice(0,10)}:${a.totalN}`;
  const t3 = a.tier3;
  const r = await runDb(env,
    `INSERT OR REPLACE INTO challenger_evaluations
      (id,sport,champion_model_id,challenger_id,paired_n,gate_json,metrics_json,eligible_for_manual_promotion,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,a.sport,a.modelId,recalibrationId,t3.pairedN,JSON.stringify(t3.gate),JSON.stringify({bootstrap:t3.bootstrap,deltas:t3.deltas,raw:a.metrics.raw,challenger:a.metrics.challenger}),t3.gate.passes?1:0,createdAt]
  );
  return { ...r, id };
}

async function persistBayesian(env, a, lastObservedAt) {
  const out = [];
  for (const s of a.states) {
    if (s.status !== "UPDATED") continue;
    out.push(await runDb(env,
      `INSERT OR REPLACE INTO bayesian_learning_state
        (sport,model_id,target,observed_n,posterior_mean,posterior_sd,prior_mean,prior_sd,last_observed_at,metadata_json,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [a.sport,a.modelId,s.target,s.observedN,s.posteriorMean,s.posteriorSd,s.priorMean,s.priorSd,lastObservedAt,JSON.stringify({recommendedCorrection:s.recommendedCorrection,advisoryOnly:true}),nowIso()]
    ));
  }
  return out;
}

async function persistShadow(env, shadow) {
  const out = [];
  for (const w of shadow.weights || []) {
    out.push(await runDb(env,
      `INSERT OR REPLACE INTO online_learning_shadow
        (sport,model_id,weight,score,observed_n,production_enabled,metadata_json,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      [shadow.sport,w.modelId,w.weight,w.score,w.n,0,JSON.stringify({shadowOnly:true,wagerAuthority:false}),nowIso()]
    ));
  }
  return out;
}

export async function runContinuousLearning(env, { sport, recentN = CONTINUOUS_LEARNING_POLICY.recentWindowN } = {}) {
  const id = String(sport || "").toLowerCase();
  const queried = await querySnapshots(env, { sport: id, since: "2000-01-01" });
  if (!queried.ok) return { ok:false, sport:id, error:queried.reason || "snapshot-query-failed" };

  const selected = selectCanonicalLearningSnapshots(queried.rows || []);
  const byModel = new Map();
  for (const row of selected.rows) {
    if (snapshotMarketInformed(row)) continue;
    const modelId = row.learningModelId || snapshotModelId(row);
    if (!byModel.has(modelId)) byModel.set(modelId, []);
    byModel.get(modelId).push(row);
  }

  const models = [];
  const errors = [];
  for (const [modelId, rows] of byModel.entries()) {
    const monitoring = buildMonitoringArtifact(rows, { sport:id, modelId, recentN });
    const pm = await persistMonitoring(env, monitoring);
    if (!pm.ok) errors.push(`${modelId}:monitor:${pm.reason}`);

    let recalibration = { tier:2, status:"NOT_TRIGGERED" };
    const previousN = await lastRecalibrationN(env, id, modelId);
    const binaryN = binaryRows(rows).length;
    const newRows = Math.max(0, binaryN - previousN);
    if (binaryN >= CONTINUOUS_LEARNING_POLICY.minRecalibrationN &&
        (previousN === 0 || newRows >= CONTINUOUS_LEARNING_POLICY.minNewRowsForRecalibration)) {
      recalibration = buildRecalibrationAndGate(rows, { sport:id, modelId });
      if (recalibration.status === "FIT") {
        const pr = await persistRecalibration(env, recalibration);
        if (!pr.ok) errors.push(`${modelId}:recalibration:${pr.reason}`);
        const pc = await persistChallenger(env, recalibration, pr.id);
        if (!pc.ok) errors.push(`${modelId}:challenger:${pc.reason}`);
        recalibration.recalibrationId = pr.id;
        recalibration.challengerEvaluationId = pc.id;
      }
    } else {
      recalibration = {
        tier:2,
        status:"WAITING_FOR_SAMPLE_TRIGGER",
        n:binaryN,
        previousN,
        newRows,
        minimumN:CONTINUOUS_LEARNING_POLICY.minRecalibrationN,
        minimumNewRows:CONTINUOUS_LEARNING_POLICY.minNewRowsForRecalibration,
      };
    }

    const bayesian = bayesianBiasState(rows, { sport:id, modelId });
    const lastObservedAt = rows.map((r)=>String(r.frozenAt||"")).sort().at(-1)||null;
    const pb = await persistBayesian(env, bayesian, lastObservedAt);
    if (pb.some((x)=>!x.ok)) errors.push(`${modelId}:bayesian-write-failed`);

    models.push({ modelId, monitoring, recalibration, bayesian });
  }

  const shadow = shadowModelWeights(byModel, { sport:id });
  const ps = await persistShadow(env, shadow);
  if (ps.some((x)=>!x.ok)) errors.push("shadow-write-failed");

  return {
    ok: errors.length===0,
    status: errors.length ? "degraded" : "success",
    sport:id,
    source:"prediction_snapshots",
    queriedRows:(queried.rows||[]).length,
    canonicalRows:selected.rows.length,
    models,
    tier5:shadow,
    errors,
    governance:{
      tier1:"MONITOR_CONTINUOUSLY",
      tier2:"SAMPLE_COUNT_GATED_RECALIBRATION",
      tier3:"PAIRED_BOOTSTRAP_AND_MANUAL_PROMOTION",
      tier4:"BAYESIAN_SHRINKAGE_ADVISORY",
      tier5:"SHADOW_ONLY",
      autoPromote:false,
      autoWagerAuthority:false,
      productionOnlineLearning:false,
    },
    generatedAt:nowIso(),
  };
}
