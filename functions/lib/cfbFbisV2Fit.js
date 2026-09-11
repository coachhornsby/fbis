/**
 * Ridge / OLS fit utilities for CFB-FBIS-v2 rolling-origin calibration.
 * Train-only scaler/imputer. No random splits.
 */

export function mean(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export function variance(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length;
}

export function mae(y, yhat) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(yhat[i])) continue;
    s += Math.abs(y[i] - yhat[i]);
    n += 1;
  }
  return n ? s / n : null;
}

export function rmse(y, yhat) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(yhat[i])) continue;
    const e = y[i] - yhat[i];
    s += e * e;
    n += 1;
  }
  return n ? Math.sqrt(s / n) : null;
}

export function bias(y, yhat) {
  // bias = mean(prediction - actual); positive ⇒ overpredict home margin
  let s = 0;
  let n = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(yhat[i])) continue;
    s += yhat[i] - y[i];
    n += 1;
  }
  return n ? s / n : null;
}

export function clamp01(p) {
  return Math.min(0.999, Math.max(0.001, p));
}

/** Normal CDF approx */
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

export function pHomeWinFromMargin(margin, sigma = 16.5) {
  return clamp01(normalCdf(Number(margin) / Math.max(1e-6, Number(sigma) || 16.5)));
}

export function brierScore(p, yBinary) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(yBinary[i])) continue;
    const e = p[i] - yBinary[i];
    s += e * e;
    n += 1;
  }
  return n ? s / n : null;
}

export function logLoss(p, yBinary) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(yBinary[i])) continue;
    const pp = clamp01(p[i]);
    s += -(yBinary[i] * Math.log(pp) + (1 - yBinary[i]) * Math.log(1 - pp));
    n += 1;
  }
  return n ? s / n : null;
}

/** OLS calibration: actual ≈ a + b * logit(p) or raw p. Returns slope/intercept on probability. */
export function calibrationSlopeIntercept(p, yBinary) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(yBinary[i])) continue;
    xs.push(p[i]);
    ys.push(yBinary[i]);
  }
  if (xs.length < 10) return { slope: null, intercept: null, n: xs.length };
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  const slope = den > 0 ? num / den : null;
  const intercept = slope == null ? null : my - slope * mx;
  return { slope, intercept, n: xs.length };
}

export function calibrationBuckets(p, yBinary, edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]) {
  const buckets = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const lo = edges[b];
    const hi = edges[b + 1];
    let n = 0;
    let sumP = 0;
    let sumY = 0;
    for (let i = 0; i < p.length; i++) {
      if (!Number.isFinite(p[i]) || !Number.isFinite(yBinary[i])) continue;
      if (p[i] >= lo && p[i] < hi) {
        n += 1;
        sumP += p[i];
        sumY += yBinary[i];
      }
    }
    buckets.push({
      lo,
      hi,
      n,
      meanPredicted: n ? sumP / n : null,
      meanActual: n ? sumY / n : null,
    });
  }
  return buckets;
}

export function intervalCoverage(y, yhat, sigma, z = 1.0) {
  let hit = 0;
  let n = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(yhat[i]) || !Number.isFinite(sigma[i])) continue;
    const lo = yhat[i] - z * sigma[i];
    const hi = yhat[i] + z * sigma[i];
    if (y[i] >= lo && y[i] <= hi) hit += 1;
    n += 1;
  }
  return { n, coverage: n ? hit / n : null, z };
}

/** Gaussian elimination solve Ax=b for small dense systems. */
export function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Fit ridge: y ~ X β with intercept.
 * X is n×p (no intercept column). Returns { intercept, beta, featureMeans, featureStds, lambda }.
 * Impute missing with train means; scale to z-scores using train std (std=0 → 0).
 */
export function fitRidge(X, y, { lambda = 10, featureNames = null } = {}) {
  const n = y.length;
  const p = X[0]?.length || 0;
  const names = featureNames || Array.from({ length: p }, (_, i) => `f${i}`);
  const means = Array(p).fill(0);
  const stds = Array(p).fill(0);
  const counts = Array(p).fill(0);

  for (let j = 0; j < p; j++) {
    const col = [];
    for (let i = 0; i < n; i++) {
      const v = X[i][j];
      if (Number.isFinite(v)) {
        col.push(v);
        counts[j] += 1;
      }
    }
    means[j] = mean(col);
    stds[j] = Math.sqrt(variance(col)) || 0;
  }

  const Z = Array.from({ length: n }, () => Array(p + 1).fill(0));
  for (let i = 0; i < n; i++) {
    Z[i][0] = 1;
    for (let j = 0; j < p; j++) {
      const v = Number.isFinite(X[i][j]) ? X[i][j] : means[j];
      Z[i][j + 1] = stds[j] > 1e-9 ? (v - means[j]) / stds[j] : 0;
    }
  }

  // (Z'Z + λI) β = Z'y ; do not penalize intercept
  const m = p + 1;
  const XtX = Array.from({ length: m }, () => Array(m).fill(0));
  const Xty = Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i])) continue;
    for (let a = 0; a < m; a++) {
      Xty[a] += Z[i][a] * y[i];
      for (let b = 0; b < m; b++) XtX[a][b] += Z[i][a] * Z[i][b];
    }
  }
  for (let j = 1; j < m; j++) XtX[j][j] += lambda;
  const sol = solveLinearSystem(XtX, Xty);
  if (!sol) {
    return {
      ok: false,
      intercept: mean(y.filter(Number.isFinite)),
      beta: Array(p).fill(0),
      means,
      stds,
      lambda,
      featureNames: names,
      n,
    };
  }
  return {
    ok: true,
    intercept: sol[0],
    beta: sol.slice(1),
    means,
    stds,
    lambda,
    featureNames: names,
    n,
    presentRates: counts.map((c) => c / n),
  };
}

export function predictRidge(model, X) {
  const { intercept, beta, means, stds } = model;
  const p = beta.length;
  const out = Array(X.length);
  for (let i = 0; i < X.length; i++) {
    let s = intercept;
    for (let j = 0; j < p; j++) {
      const v = Number.isFinite(X[i][j]) ? X[i][j] : means[j];
      const z = stds[j] > 1e-9 ? (v - means[j]) / stds[j] : 0;
      s += beta[j] * z;
    }
    out[i] = s;
  }
  return out;
}

/** Tune lambda on a chronological holdout within train (last season of train). */
export function tuneRidgeLambda(Xtrain, ytrain, Xval, yval, lambdas = [0.3, 1, 3, 10, 30, 100, 300]) {
  let best = null;
  for (const lambda of lambdas) {
    const model = fitRidge(Xtrain, ytrain, { lambda });
    const pred = predictRidge(model, Xval);
    const score = mae(yval, pred);
    if (score == null) continue;
    if (!best || score < best.mae) best = { lambda, mae: score, model };
  }
  return best || { lambda: 10, mae: null, model: fitRidge(Xtrain, ytrain, { lambda: 10 }) };
}

/**
 * Block bootstrap for paired metric deltas.
 * blocks: array of arrays of indices sharing dependence (e.g. season-week).
 */
export function pairedBlockBootstrap(metricA, metricB, blocks, { nBoot = 400, seed = 42 } = {}) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const deltas = [];
  for (let b = 0; b < nBoot; b++) {
    let sumA = 0;
    let sumB = 0;
    let n = 0;
    for (let k = 0; k < blocks.length; k++) {
      const block = blocks[Math.floor(rand() * blocks.length)];
      for (const idx of block) {
        if (!Number.isFinite(metricA[idx]) || !Number.isFinite(metricB[idx])) continue;
        sumA += metricA[idx];
        sumB += metricB[idx];
        n += 1;
      }
    }
    if (n) deltas.push(sumB / n - sumA / n);
  }
  deltas.sort((a, b) => a - b);
  const q = (p) => deltas[Math.min(deltas.length - 1, Math.max(0, Math.floor(p * deltas.length)))];
  return {
    nBoot: deltas.length,
    mean: mean(deltas),
    ci95: [q(0.025), q(0.975)],
    signPositiveShare: deltas.filter((d) => d > 0).length / Math.max(1, deltas.length),
  };
}

export const ABLATION_FEATURE_SETS = {
  A: ["base"],
  B: ["base", "pass", "rush"],
  C: ["base", "pass", "rush", "success"],
  D: ["base", "pass", "rush", "success", "explosiveness"],
  E: ["base", "pass", "rush", "success", "explosiveness", "havoc"],
  F: ["base", "pass", "rush", "success", "explosiveness", "havoc", "trenches"],
  G: ["base", "pass", "rush", "success", "explosiveness", "havoc", "trenches", "finishing"],
  H: ["base", "pass", "rush", "success", "explosiveness", "havoc", "trenches", "finishing", "qb"],
  I: ["base", "pass", "rush", "success", "explosiveness", "havoc", "trenches", "finishing", "qb", "pace"],
  J: ["base", "pass", "rush", "success", "explosiveness", "havoc", "trenches", "finishing", "qb", "pace", "context"],
  K: ["base", "pass", "rush", "success", "explosiveness", "havoc", "trenches", "finishing", "qb", "pace", "context"],
};

export const TOTAL_FEATURE_SETS = {
  A: ["base_total"],
  B: ["base_total", "pass_total", "rush_total"],
  C: ["base_total", "pass_total", "rush_total", "success_total"],
  D: ["base_total", "pass_total", "rush_total", "success_total", "explosiveness_total"],
  E: ["base_total", "pass_total", "rush_total", "success_total", "explosiveness_total", "havoc_total"],
  F: ["base_total", "pass_total", "rush_total", "success_total", "explosiveness_total", "havoc_total", "trenches_total"],
  G: [
    "base_total",
    "pass_total",
    "rush_total",
    "success_total",
    "explosiveness_total",
    "havoc_total",
    "trenches_total",
    "finishing_total",
  ],
  H: [
    "base_total",
    "pass_total",
    "rush_total",
    "success_total",
    "explosiveness_total",
    "havoc_total",
    "trenches_total",
    "finishing_total",
    "qb_total",
  ],
  I: [
    "base_total",
    "pass_total",
    "rush_total",
    "success_total",
    "explosiveness_total",
    "havoc_total",
    "trenches_total",
    "finishing_total",
    "qb_total",
    "pace_total",
  ],
  J: [
    "base_total",
    "pass_total",
    "rush_total",
    "success_total",
    "explosiveness_total",
    "havoc_total",
    "trenches_total",
    "finishing_total",
    "qb_total",
    "pace_total",
    "context_total",
  ],
  K: [
    "base_total",
    "pass_total",
    "rush_total",
    "success_total",
    "explosiveness_total",
    "havoc_total",
    "trenches_total",
    "finishing_total",
    "qb_total",
    "pace_total",
    "context_total",
  ],
};

export function rowToMarginX(row, featureNames) {
  return featureNames.map((name) => {
    const v = row.marginFeatures?.[name];
    return Number.isFinite(v) ? v : null;
  });
}

export function rowToTotalX(row, featureNames) {
  return featureNames.map((name) => {
    const v = row.totalFeatures?.[name];
    return Number.isFinite(v) ? v : null;
  });
}

export function scoreMetrics({
  actualMargin,
  predMargin,
  actualTotal,
  predTotal,
  actualHome,
  predHome,
  actualAway,
  predAway,
  pHome,
  homeWon,
  marginSigma,
}) {
  const absMarginErr = actualMargin.map((y, i) => Math.abs(predMargin[i] - y));
  const absTotalErr = actualTotal.map((y, i) => Math.abs(predTotal[i] - y));
  return {
    n: actualMargin.filter((_, i) => Number.isFinite(actualMargin[i]) && Number.isFinite(predMargin[i])).length,
    maeMargin: mae(actualMargin, predMargin),
    rmseMargin: rmse(actualMargin, predMargin),
    biasMargin: bias(actualMargin, predMargin),
    biasSignConvention: "biasMargin = mean(predMargin - actualMargin); positive overpredicts home margin (home-away)",
    maeTotal: mae(actualTotal, predTotal),
    rmseTotal: rmse(actualTotal, predTotal),
    maeHome: mae(actualHome, predHome),
    maeAway: mae(actualAway, predAway),
    maeTeam: mean(
      [...actualHome.map((y, i) => Math.abs(predHome[i] - y)), ...actualAway.map((y, i) => Math.abs(predAway[i] - y))].filter(
        Number.isFinite
      )
    ),
    brier: brierScore(pHome, homeWon),
    logLoss: logLoss(pHome, homeWon),
    calibration: calibrationSlopeIntercept(pHome, homeWon),
    calibrationBuckets: calibrationBuckets(pHome, homeWon),
    intervalCoverage1sig: intervalCoverage(actualMargin, predMargin, marginSigma, 1),
    absMarginErr,
    absTotalErr,
  };
}
