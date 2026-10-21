/**
 * All-sport simulation and calibration research (shadow-only).
 * The caller supplies sport-specific game logic and prospectively frozen forecasts.
 * This module provides no market prices, bet selection, production writes or authority.
 */
export const SPORT_SIM_SPECS = Object.freeze({
  nfl: { unit: "play", domains: ["game", "pass", "rush", "receive", "touchdown"], cautions: ["overtime", "sacks-as-rushing", "inactive-players"] },
  cfb: { unit: "play", domains: ["game", "pass", "rush", "receive", "touchdown"], cautions: ["overtime", "college-sack-accounting", "roster-identity"] },
  nba: { unit: "possession", domains: ["game", "points", "rebounds", "assists", "threes"], cautions: ["minutes", "overtime", "role-changes"] },
  cbb: { unit: "possession", domains: ["game", "points", "rebounds", "assists", "threes"], cautions: ["minutes", "overtime", "college-stat-coverage"] },
  wnba: { unit: "possession", domains: ["game", "points", "rebounds", "assists", "threes"], cautions: ["minutes", "overtime", "role-changes"] },
  mlb: { unit: "plate_appearance", domains: ["game", "runs", "hits", "strikeouts", "home_runs"], cautions: ["starting-pitcher", "lineup", "extra-innings", "listed-pitcher-rules"] },
  npb: { unit: "plate_appearance", domains: ["game", "runs", "hits", "strikeouts", "home_runs"], cautions: ["lineup", "tie-rules", "extra-innings"] },
  kbo: { unit: "plate_appearance", domains: ["game", "runs", "hits", "strikeouts", "home_runs"], cautions: ["lineup", "tie-rules", "extra-innings"] },
  nhl: { unit: "shot_attempt", domains: ["game", "goals", "shots", "points", "goalie_saves"], cautions: ["starting-goalie", "empty-net", "overtime", "shootout-settlement"] },
  soccer: { unit: "possession", domains: ["game", "goals", "shots", "cards", "corners"], cautions: ["three-way-result", "stoppage-time", "extra-time-market-rules"] },
  tennis: { unit: "point", domains: ["match", "sets", "games", "aces", "breaks"], cautions: ["surface", "best-of-sets", "retirement-rules", "tiebreaks"] },
});
export const SPORT_SIM_SPORTS = Object.freeze(Object.keys(SPORT_SIM_SPECS));

function sportKey(sport) {
  const key = String(sport || "").trim().toLowerCase();
  if (!Object.hasOwn(SPORT_SIM_SPECS, key)) throw new Error("UNSUPPORTED_SPORT");
  return key;
}
function time(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Date.parse(value);
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function quantile(sorted, p) {
  const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p05: quantile(sorted, .05),
    p10: quantile(sorted, .10),
    p50: quantile(sorted, .50),
    p90: quantile(sorted, .90),
    p95: quantile(sorted, .95),
    mean: average(sorted),
  };
}
function rng(seed) {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 4294967295) throw new Error("INVALID_SEED");
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
/**
 * A numerical Monte Carlo harness, NOT an implemented sport model.
 * Every iteration comes from the caller's sport-specific generator.
 * The same iteration generates all game/player metrics, preserving dependencies.
 * Omitting a player in one iteration is not interpreted as zero; the output
 * metric set must be identical on every iteration.
 */
export function runSportSimulationResearch({
  sport, eventId, modelId, modelVersion, publishedAt, eventStart,
  iterations = 5000, seed = 1, simulate,
} = {}) {
  const key = sportKey(sport);
  if (![eventId, modelId, modelVersion].every(v => typeof v === "string" && v.trim())) throw new Error("MISSING_MODEL_IDENTITY");
  if (!(Number.isFinite(time(publishedAt)) && Number.isFinite(time(eventStart)) && time(publishedAt) < time(eventStart))) throw new Error("NOT_FROZEN_PREGAME");
  if (!Number.isSafeInteger(iterations) || iterations < 100 || iterations > 20000) throw new Error("INVALID_ITERATION_COUNT");
  if (typeof simulate !== "function") throw new Error("SPORT_SPECIFIC_GENERATOR_REQUIRED");
  const random = rng(seed);
  const columns = new Map();
  let expected = null;
  for (let i = 0; i < iterations; i++) {
    const out = simulate({ random, index: i, sport: key });
    if (!out || !out.metrics || typeof out.metrics !== "object" || Array.isArray(out.metrics)) throw new Error("INVALID_SIMULATION_SAMPLE");
    const keys = Object.keys(out.metrics).sort();
    if (!keys.length || keys.some(k => !k.trim() || !finite(out.metrics[k]))) throw new Error("INVALID_SIMULATION_SAMPLE");
    const signature = JSON.stringify(keys);
    if (expected === null) {
      expected = signature;
      for (const k of keys) columns.set(k, []);
    } else if (signature !== expected) {
      throw new Error("INCONSISTENT_SIMULATION_METRICS");
    }
    for (const k of keys) columns.get(k).push(out.metrics[k]);
  }
  return {
    sport: key, eventId, modelId, modelVersion, publishedAt, eventStart,
    iterations, seed, unit: SPORT_SIM_SPECS[key].unit,
    distributions: Object.fromEntries([...columns].map(([k, values]) => [k, summary(values)])),
    phase: "RESEARCH_ONLY", generator: "CALLER_SUPPLIED",
    canQualify: false, canAuthorizeWager: false, changesProductionChampion: false,
  };
}
function accepted(row) {
  let sport;
  try { sport = sportKey(row?.sport); } catch { return { error: "UNSUPPORTED_SPORT" }; }
  if (![row?.eventId, row?.modelId, row?.modelVersion, row?.marketKey, row?.statKey].every(v => typeof v === "string" && v.trim())) return { error: "MISSING_IDENTITY" };
  const published = time(row.publishedAt), start = time(row.eventStart), settled = time(row.settledAt);
  if (!(Number.isFinite(published) && Number.isFinite(start) && Number.isFinite(settled) && published < start && settled >= start)) return { error: "INVALID_TEMPORAL_EVIDENCE" };
  if (row.official !== true || row.prospective !== true || row.identityVerified !== true) return { error: "UNVERIFIED_OUTCOME" };
  if (row.kind === "binary") {
    if (!finite(row.probability) || row.probability < 0 || row.probability > 1 || (row.actual !== 0 && row.actual !== 1)) return { error: "INVALID_BINARY_FORECAST" };
  } else if (row.kind === "quantity") {
    const q = row.quantiles || {};
    const values = [q.p05, q.p10, q.p50, q.p90, q.p95];
    if (!finite(row.actual) || values.some(v => !finite(v)) || values.some((v, i) => i > 0 && v < values[i-1])) return { error: "INVALID_QUANTILE_FORECAST" };
  } else return { error: "UNKNOWN_FORECAST_KIND" };
  return { sport };
}
/**
 * Strict descriptive grading of immutable prospective rows.
 * Separate forecasts for the same event/stat/model are not independent:
 * callers must supply one canonical pregame snapshot per forecast identity.
 * No market/economic metric is calculated from an absent execution ledger.
 */
export function gradeSportSimulationResearch(rows = [], { minimumSample = 100 } = {}) {
  if (!Array.isArray(rows)) throw new TypeError("ROWS_MUST_BE_ARRAY");
  if (!Number.isSafeInteger(minimumSample) || minimumSample < 1) throw new Error("INVALID_MINIMUM_SAMPLE");
  const errors = {}, cohorts = new Map(), seen = new Set();
  for (const row of rows) {
    const valid = accepted(row);
    if (valid.error) { errors[valid.error] = (errors[valid.error] || 0) + 1; continue; }
    const identity = [valid.sport, row.eventId, row.modelId, row.modelVersion, row.marketKey, row.statKey].join("|");
    if (seen.has(identity)) { errors.DUPLICATE_FORECAST = (errors.DUPLICATE_FORECAST || 0) + 1; continue; }
    seen.add(identity);
    const cohortId = [valid.sport, row.modelId, row.modelVersion, row.marketKey, row.statKey, row.kind].join("|");
    if (!cohorts.has(cohortId)) cohorts.set(cohortId, { sport: valid.sport, modelId: row.modelId, modelVersion: row.modelVersion, marketKey: row.marketKey, statKey: row.statKey, kind: row.kind, rows: [] });
    cohorts.get(cohortId).rows.push(row);
  }
  const results = [...cohorts.values()].map(c => {
    const n = c.rows.length, base = { sport: c.sport, modelId: c.modelId, modelVersion: c.modelVersion, marketKey: c.marketKey, statKey: c.statKey, kind: c.kind, n, status: n >= minimumSample ? "DESCRIPTIVE_ONLY" : "INSUFFICIENT_SAMPLE" };
    if (c.kind === "quantity") {
      const v = c.rows;
      return { ...base,
        medianMae: average(v.map(r => Math.abs(r.actual - r.quantiles.p50))),
        medianBias: average(v.map(r => r.actual - r.quantiles.p50)),
        coverage80: average(v.map(r => Number(r.actual >= r.quantiles.p10 && r.actual <= r.quantiles.p90))),
        coverage90: average(v.map(r => Number(r.actual >= r.quantiles.p05 && r.actual <= r.quantiles.p95))),
        upper90Breach: average(v.map(r => Number(r.actual > r.quantiles.p90))),
        lower10Breach: average(v.map(r => Number(r.actual < r.quantiles.p10))),
        brier: null, logLoss: null,
      };
    }
    const brier = average(c.rows.map(r => (r.probability-r.actual)**2));
    const logLoss = average(c.rows.map(r => {
      const p = Math.max(1e-12, Math.min(1-1e-12, r.probability));
      return -(r.actual*Math.log(p)+(1-r.actual)*Math.log(1-p));
    }));
    const bins = Array.from({ length: 10 }, (_, i) => ({ bin: i, count: 0, probabilitySum: 0, outcomeSum: 0 }));
    for (const r of c.rows) {
      const b = bins[Math.min(9, Math.floor(r.probability * 10))];
      b.count++; b.probabilitySum += r.probability; b.outcomeSum += r.actual;
    }
    return { ...base, brier, logLoss,
      reliability: bins.map(b => ({ bin: b.bin, n: b.count, predicted: b.count ? b.probabilitySum/b.count : null, observed: b.count ? b.outcomeSum/b.count : null })),
      medianMae: null, medianBias: null, coverage80: null, coverage90: null, upper90Breach: null, lower10Breach: null,
    };
  }).sort((a,b) => [a.sport,a.marketKey,a.statKey,a.modelId].join("|").localeCompare([b.sport,b.marketKey,b.statKey,b.modelId].join("|")));
  return { accepted: results.reduce((s, x) => s + x.n, 0), rejected: Object.values(errors).reduce((s, x) => s + x, 0),
    errors, cohorts: results, economicMetrics: null, economicEvidence: "REQUIRES_CANONICAL_EXECUTION_LEDGER",
    phase: "RESEARCH_ONLY", canQualify: false, canAuthorizeWager: false, changesProductionChampion: false };
}
