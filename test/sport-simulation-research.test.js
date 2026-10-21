import test from "node:test";
import assert from "node:assert/strict";
import { SPORT_SIM_SPECS, SPORT_SIM_SPORTS, runSportSimulationResearch, gradeSportSimulationResearch } from "../functions/lib/sportSimulationResearch.js";

const sports = ["nfl","cfb","nhl","nba","mlb","cbb","wnba","soccer","tennis","npb","kbo"];
const frozen = { eventId: "fixture-1", modelId: "shadow-generator", modelVersion: "v1", publishedAt: "2026-10-20T11:00:00Z", eventStart: "2026-10-21T11:00:00Z" };
const evidence = { ...frozen, settledAt: "2026-10-21T15:00:00Z", official: true, prospective: true, identityVerified: true, marketKey: "research", statKey: "metric", subjectId: "player-1", snapshotId: "s1", settlementId: "final-1" };

test("all 11 sports have independent units and rule cautions, but no authority", () => {
  assert.deepEqual([...SPORT_SIM_SPORTS].sort(), [...sports].sort());
  for (const sport of sports) {
    assert.ok(SPORT_SIM_SPECS[sport].domains.length);
    assert.ok(SPORT_SIM_SPECS[sport].cautions.length);
  }
  assert.equal(SPORT_SIM_SPECS.tennis.unit, "point");
  assert.equal(SPORT_SIM_SPECS.nhl.unit, "shot_attempt");
  assert.notEqual(SPORT_SIM_SPECS.nfl.unit, SPORT_SIM_SPECS.mlb.unit);
});

test("seeded simulator is deterministic, distributional, correlated and shadow-only", () => {
  const run = () => runSportSimulationResearch({ ...frozen, sport: "nfl", iterations: 500, seed: 1925,
    simulate: ({ random }) => { const x = random(); return { metrics: { home_points: Math.floor(x*35), qb_attempts: 20 + Math.floor(x*25) } }; },
  });
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a.distributions.qb_attempts.n, 500);
  assert.ok(a.distributions.home_points.p10 <= a.distributions.home_points.p90);
  assert.equal(a.canAuthorizeWager, false);
  assert.equal(a.changesProductionChampion, false);
});

test("simulator rejects future forecasts, missing generators, inconsistent player metric sets", () => {
  assert.throws(() => runSportSimulationResearch({ ...frozen, sport: "nfl", publishedAt: frozen.eventStart, simulate: () => ({ metrics: { score: 1 } }) }), /NOT_FROZEN_PREGAME/);
  assert.throws(() => runSportSimulationResearch({ ...frozen, sport: "nfl" }), /SPORT_SPECIFIC_GENERATOR_REQUIRED/);
  assert.throws(() => runSportSimulationResearch({ ...frozen, sport: "soccer", iterations: 100,
    simulate: ({ index }) => ({ metrics: index % 2 ? { shots: 1 } : { goals: 1 } }) }), /INCONSISTENT_SIMULATION_METRICS/);
  assert.throws(() => runSportSimulationResearch({ ...frozen, sport: "nhl", iterations: 100,
    simulate: () => ({ metrics: { goals: NaN } }) }), /INVALID_SIMULATION_SAMPLE/);
});

test("prospective 80% and 90% coverage, upper-tail breaches and median bias are scored by sport/model/market", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...evidence, sport: "nfl", eventId: "g-"+i, kind: "quantity",
    actual: i < 80 ? 5 : 13,
    quantiles: { p05: 0, p10: 1, p25: 3, p50: 5, p75: 7, p90: 10, p95: 12 },
  }));
  const x = gradeSportSimulationResearch(rows);
  assert.equal(x.accepted, 100);
  assert.equal(x.cohorts[0].coverage50, .8);
  assert.equal(x.cohorts[0].coverage80, .8);
  assert.equal(x.cohorts[0].coverage90, .8);
  assert.equal(x.cohorts[0].upper90Breach, .2);
  assert.equal(x.cohorts[0].medianBias, 1.6);
  assert.equal(x.cohorts[0].status, "DESCRIPTIVE_ONLY");
  assert.equal(x.economicMetrics, null);
  assert.equal(x.canQualify, false);
});

test("binary Brier and log loss are separated from quantitative interval metrics", () => {
  const rows = [0,1].map((actual, i) => ({ ...evidence, eventId: "game"+i, sport: "tennis", kind: "binary", actual, probability: .5 }));
  const graded = gradeSportSimulationResearch(rows, { minimumSample: 2 });
  assert.equal(graded.cohorts[0].brier, .25);
  assert.ok(Math.abs(graded.cohorts[0].logLoss - Math.log(2)) < 1e-9);
  assert.equal(graded.cohorts[0].coverage50, null);
  assert.equal(graded.cohorts[0].coverage80, null);
  assert.equal(graded.cohorts[0].status, "DESCRIPTIVE_ONLY");
});

test("post-start, nonofficial, retrospectives, invalid probability, and duplicate forecasts fail closed", () => {
  const good = { ...evidence, sport: "mlb", kind: "binary", probability: .6, actual: 1 };
  const graded = gradeSportSimulationResearch([
    good, good,
    { ...good, eventId: "late", publishedAt: "2026-10-21T13:00:00Z" },
    { ...good, eventId: "retro", prospective: false },
    { ...good, eventId: "unverified", official: false },
    { ...good, eventId: "badprob", probability: 1.3 },
    { ...good, eventId: "badstatus", settledAt: "2026-10-21T10:00:00Z" },
  ]);
  assert.equal(graded.accepted, 1);
  assert.equal(graded.rejected, 6);
  assert.equal(graded.errors.DUPLICATE_FORECAST, 1);
  assert.equal(graded.errors.INVALID_TEMPORAL_EVIDENCE, 2);
  assert.equal(graded.errors.UNVERIFIED_OUTCOME, 2);
  assert.equal(graded.errors.INVALID_BINARY_FORECAST, 1);
});

test("two player subjects in the same event must remain separate valid forecasts", () => {
  const base = { ...evidence, sport: "nfl", kind: "binary", probability: .7, actual: 1 };
  const graded = gradeSportSimulationResearch([base, { ...base, subjectId: "player-2", snapshotId: "s2", settlementId: "f2" }]);
  assert.equal(graded.accepted, 2);
  assert.equal(graded.errors.DUPLICATE_FORECAST, undefined);
});

test("missing canonical snapshot or official settlement reference is rejected", () => {
  const row = { ...evidence, sport: "nfl", kind: "binary", probability: .5, actual: 1 };
  const graded = gradeSportSimulationResearch([{ ...row, snapshotId: null }, { ...row, eventId: "g2", settlementId: null }]);
  assert.equal(graded.accepted, 0);
  assert.equal(graded.errors.MISSING_IDENTITY, 2);
});

test("separate sports, models and markets never share performance", () => {
  const row = { ...evidence, kind: "quantity", actual: 2, quantiles: { p05: 0,p10: 1,p25: 1.5,p50: 2,p75: 2.5,p90: 3,p95: 4 } };
  const graded = gradeSportSimulationResearch([
    { ...row, sport: "npb" },
    { ...row, sport: "kbo" },
    { ...row, sport: "nfl", marketKey: "yards" },
    { ...row, sport: "nfl", marketKey: "touchdowns" },
  ]);
  assert.equal(graded.cohorts.length, 4);
  assert.ok(graded.cohorts.every(c => c.status === "INSUFFICIENT_SAMPLE"));
});
