/**
 * Shared research metrics. Sport-specific within-X — never MLB thresholds globally.
 */

export function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mae(errs) {
  return mean((errs || []).map((e) => Math.abs(e)));
}

export function rmse(errs) {
  if (!errs?.length) return null;
  return Math.sqrt(mean(errs.map((e) => e ** 2)));
}

export function bias(errs) {
  return mean(errs || []);
}

export function withinShare(errs, thr) {
  if (!errs?.length) return null;
  return errs.filter((e) => Math.abs(e) <= thr).length / errs.length;
}

/** Documented sport bands. Football/basketball are wider than baseball. */
export const SPORT_WITHIN = {
  mlb: {
    team: [0.5, 1, 2, 3],
    total: [0.5, 1, 2, 3, 4],
    margin: [1, 2, 3, 4],
  },
  nfl: {
    team: [3, 7, 10, 14],
    total: [3, 7, 10, 14],
    margin: [3, 7, 10, 14],
  },
  cfb: {
    team: [3, 7, 10, 14],
    total: [3, 7, 10, 14],
    margin: [3, 7, 10, 14],
  },
  nba: {
    team: [4, 8, 12, 16],
    total: [5, 10, 15, 20],
    margin: [5, 10, 15],
  },
  cbb: {
    team: [4, 8, 12, 16],
    total: [5, 10, 15, 20],
    margin: [5, 10, 15],
  },
};

export function withinKey(thr) {
  if (thr === 0.5) return "within05";
  return `within${String(thr).replace(".", "")}`;
}

export function withinLabel(thr) {
  return `Within ${thr}`;
}

export function withinBands(errs, sport, kind) {
  const bands = SPORT_WITHIN[sport]?.[kind] || SPORT_WITHIN.mlb[kind];
  const out = { n: errs?.length || 0, sport: sport || "mlb", kind, bands: [] };
  for (const thr of bands) {
    const share = withinShare(errs, thr);
    out[withinKey(thr)] = share;
    out.bands.push({ threshold: thr, label: withinLabel(thr), share });
  }
  return out;
}

export function erf(z) {
  const x = Number(z);
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-a * a);
  return sign * y;
}

/** P(X <= x) for Normal(mu, sigma). */
export function normalCdf(x, mu, sigma) {
  const s = Number(sigma);
  if (!Number.isFinite(s) || s <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((Number(x) - Number(mu)) / (s * Math.SQRT2)));
}

export function pGreater(meanVal, line, sigma) {
  if (meanVal == null || line == null || sigma == null) return null;
  return 1 - normalCdf(Number(line), Number(meanVal), Number(sigma));
}

export function pCoverHome(projMargin, homeSpread, sigma) {
  if (projMargin == null || homeSpread == null || sigma == null) return null;
  return pGreater(Number(projMargin) + Number(homeSpread), 0, sigma);
}
