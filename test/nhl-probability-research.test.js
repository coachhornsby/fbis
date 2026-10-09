import test from "node:test";
import assert from "node:assert/strict";
import { buildNhlResearchMarkets } from "../functions/lib/nhlProbabilityResearch.js";

// Synthetic settlement fixtures. These are not trained NHL predictions or validation evidence.
const provenance = { eventId: "fixture", homeTeamId: "fixture-home", awayTeamId: "fixture-away",
  modelId: "synthetic-test-only", modelVersion: "1",
  artifactSha256: "a".repeat(64), trainedAtMs: 100, featureCutoffAtMs: 200,
  snapshotAtMs: 300, eventStartMs: 400 };
function fixture() {
  return { eventId: "fixture", regulation: { scoreBasis: "REGULATION", provenance: { ...provenance },
    cells: [{ home: 2, away: 2, probability: 0.4 },
      { home: 4, away: 1, probability: 0.3 }, { home: 1, away: 3, probability: 0.3 }] },
  overtime: { scoreBasis: "NHL_FINAL_ONE_DECIDING_GOAL", provenance: { ...provenance },
    ties: [{ goals: 2, homeWinProbability: 0.6 }] },
  marketLines: [{ family: "TOTAL", line: 5 }, { family: "PUCK_LINE", line: -1.5, side: "home" },
    { family: "TEAM_TOTAL", line: 2.5, side: "home" }] };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('positive resolved mass below PMF tolerance is not ALL_PUSH', () => {
  const f = fixture();
  f.regulation.cells = [{ home: 2, away: 0, probability: 1 - 2e-11 },
    { home: 3, away: 0, probability: 1e-11 }, { home: 1, away: 0, probability: 1e-11 }];
  f.marketLines = [{ family: 'TOTAL', line: 2 }];
  const q = buildNhlResearchMarkets(f).fullGame.markets[0].selection;
  assert.equal(q.win, 1e-11); assert.equal(q.lose, 1e-11);
  assert.equal(q.conditionalOnNoPush, 0.5);
  assert.equal(q.fairOddsStatus, 'AVAILABLE');
  assert.equal(q.fairDecimalOdds, 2); assert.equal(q.fairAmericanOdds, -100);
});

for (const tiny of [Number.MIN_VALUE, 1e-310]) {
  test(`accepted tiny probability keeps nonfinite odds unavailable: ${tiny}`, () => {
    const f = fixture();
    f.regulation.cells = [{ home: 1, away: 0, probability: tiny }, { home: 0, away: 1, probability: 1 }];
    const q = buildNhlResearchMarkets(f).fullGame.moneyline.home;
    assert.equal(q.win, tiny);
    assert.equal(q.fairOddsStatus, 'NUMERIC_DOMAIN_UNAVAILABLE');
    assert.equal(q.fairDecimalOdds, null);
    assert.equal(q.fairAmericanOdds, null);
    assert.deepEqual(JSON.parse(JSON.stringify(q)), q);
    assert.equal(q.canAuthorizeWager, false);
  });
}
test('finite extreme fair odds and standard odds remain available without probability clamping', () => {
  for (const probability of [1e-100, 1e-308, 0.25, 0.75]) {
    const f = fixture();
    f.regulation.cells = [{ home: 1, away: 0, probability }, { home: 0, away: 1, probability: 1 - probability }];
    const q = buildNhlResearchMarkets(f).fullGame.moneyline.home;
    assert.equal(q.win, probability);
    // American odds can overflow before the decimal reciprocal does.
    if (probability === 1e-308) {
      assert.equal(q.fairOddsStatus, 'NUMERIC_DOMAIN_UNAVAILABLE');
      assert.equal(q.fairDecimalOdds, null); assert.equal(q.fairAmericanOdds, null);
    } else {
      assert.equal(q.fairOddsStatus, 'AVAILABLE');
      assert.ok(Number.isFinite(q.fairDecimalOdds)); assert.ok(Number.isFinite(q.fairAmericanOdds));
    }
  }
});

test("regulation and OT/SO moneyline reconcile from the same supplied law", () => {
  const r = buildNhlResearchMarkets(fixture());
  close(r.regulation.home.win, 0.3); close(r.regulation.draw.win, 0.4);
  close(r.regulation.away.win, 0.3);
  close(r.fullGame.moneyline.home.win, 0.54); close(r.fullGame.moneyline.away.win, 0.46);
  close(r.fullGame.moneyline.draw.win, 0);
  close(r.expectedRegulationGoals.home + r.expectedRegulationGoals.away, 4.3);
  close(r.fullGame.expectedFinalGoals.home + r.fullGame.expectedFinalGoals.away, 4.7);
});
test("deciding goal changes integer total settlement without inventing a price", () => {
  const r = buildNhlResearchMarkets(fixture());
  const q = r.fullGame.markets[0];
  close(q.selection.win, 0); close(q.selection.lose, 0.3); close(q.selection.push, 0.7);
  assert.equal(q.verifiedBettingEdge, null); assert.equal(q.availability, "MODEL_ONLY");
});
test("puck line uses final score and preserves opposing probabilities", () => {
  const q = buildNhlResearchMarkets(fixture()).fullGame.markets[1];
  close(q.selection.win, 0.3); close(q.opposite.win, 0.7); close(q.selection.push, 0);
});
test("team total includes only the winning team's deciding goal", () => {
  const q = buildNhlResearchMarkets(fixture()).fullGame.markets[2];
  close(q.selection.win, 0.54); close(q.opposite.win, 0.46);
});
test("integer puck line carries push and fair odds condition only on resolved bets", () => {
  const f = fixture(); f.marketLines = [{ family: "PUCK_LINE", side: "home", line: -1 }];
  const q = buildNhlResearchMarkets(f).fullGame.markets[0].selection;
  close(q.push, 0.24); close(q.win, 0.3); close(q.lose, 0.46);
  close(q.fairDecimalOdds, 0.76 / 0.3);
  close(q.win * (q.fairDecimalOdds - 1) - q.lose, 0);
});
test("no requested line means no invented line markets", () => {
  const f = fixture(); delete f.marketLines;
  assert.deepEqual(buildNhlResearchMarkets(f).fullGame.markets, []);
});
test("missing overtime probabilities leave full game unavailable, not a 50/50 default", () => {
  const f = fixture(); delete f.overtime;
  const r = buildNhlResearchMarkets(f);
  assert.equal(r.fullGame, null); close(r.regulation.draw.win, 0.4);
  assert.ok(r.unavailable.includes("INDEPENDENT_OVERTIME_KERNEL_REQUIRED"));
});
test("no regulation ties require no invented overtime kernel", () => {
  const f = fixture(); delete f.overtime;
  f.regulation.cells = [{ home: 3, away: 1, probability: 1 }];
  close(buildNhlResearchMarkets(f).fullGame.moneyline.home.win, 1);
});
test("overtime probabilities must cover every positive-mass tied state", () => {
  const f = fixture(); f.overtime.ties = [];
  assert.throws(() => buildNhlResearchMarkets(f), /OVERTIME_STATE_MISSING/);
});
test("OT state may depend on tied score rather than expected-goal difference", () => {
  const f = fixture(); f.regulation.cells = [{ home: 1, away: 1, probability: 0.5 },
    { home: 2, away: 2, probability: 0.5 }];
  f.overtime.ties = [{ goals: 1, homeWinProbability: 0.1 }, { goals: 2, homeWinProbability: 0.7 }];
  close(buildNhlResearchMarkets(f).fullGame.moneyline.home.win, 0.4);
});
test("final-score means cannot masquerade as a regulation law", () => {
  const f = fixture(); f.regulation.scoreBasis = "FINAL";
  assert.throws(() => buildNhlResearchMarkets(f), /SCORING_TARGET_MISMATCH/);
});
test("book settlement contract is explicit and unsupported contracts fail closed", () => {
  const f = fixture(); f.overtime.scoreBasis = "EXCLUDE_SHOOTOUT";
  assert.throws(() => buildNhlResearchMarkets(f), /SETTLEMENT_CONTRACT_REQUIRED/);
});
for (const [label, mutate, error] of [
  ["negative probability", f => { f.regulation.cells[0].probability = -0.4; }, /INVALID_PMF_CELL/],
  ["non-finite probability", f => { f.regulation.cells[0].probability = NaN; }, /INVALID_PMF_CELL/],
  ["fractional goal", f => { f.regulation.cells[0].home = 1.5; }, /INVALID_PMF_CELL/],
  ["truncated law", f => { f.regulation.cells[0].probability = 0.39; }, /PMF_MASS_NOT_ONE/],
  ["duplicate cell", f => { f.regulation.cells.push({ ...f.regulation.cells[0] }); }, /DUPLICATE_PMF_CELL/],
  ["overlarge support", f => { f.regulation.cells = Array(4097).fill(f.regulation.cells[0]); }, /BOUNDED_PMF_REQUIRED/],
  ["missing provenance", f => { delete f.regulation.provenance; }, /EVENT_PROVENANCE_MISMATCH/],
  ["event mismatch", f => { f.overtime.provenance.eventId = "other"; }, /EVENT_PROVENANCE_MISMATCH/],
  ["reversed teams", f => { f.overtime.provenance.homeTeamId = "fixture-away"; f.overtime.provenance.awayTeamId = "fixture-home"; }, /TEAM_ORDER_MISMATCH/],
  ["missing team identity", f => { delete f.regulation.provenance.homeTeamId; }, /TEAM_PROVENANCE_REQUIRED/],
  ["unbounded goal support", f => { f.regulation.cells[0].home = 65; }, /INVALID_PMF_CELL/],
  ["start mismatch", f => { f.overtime.provenance.eventStartMs = 401; }, /EVENT_START_MISMATCH/],
  ["postgame freeze", f => { f.regulation.provenance.snapshotAtMs = 400; }, /POST_CUTOFF_EVIDENCE/],
  ["post-cutoff features", f => { f.regulation.provenance.featureCutoffAtMs = 301; }, /POST_CUTOFF_EVIDENCE/],
  ["post-cutoff training", f => { f.regulation.provenance.trainedAtMs = 301; }, /POST_CUTOFF_EVIDENCE/],
  ["missing time", f => { delete f.regulation.provenance.featureCutoffAtMs; }, /TEMPORAL_PROVENANCE_REQUIRED/],
  ["null line", f => { f.marketLines[0].line = null; }, /UNSUPPORTED_LINE/],
  ["quarter line", f => { f.marketLines[0].line = 5.25; }, /UNSUPPORTED_LINE/],
  ["unknown market", f => { f.marketLines[0].family = "UNKNOWN"; }, /UNSUPPORTED_MARKET_FAMILY/],
]) test(`fails closed: ${label}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => buildNhlResearchMarkets(f), error);
});
test("first period is unavailable without its own law; no one-third thinning", () => {
  const f = fixture(); const r = buildNhlResearchMarkets(f);
  assert.equal(r.firstPeriod, null);
  f.firstPeriodLines = [{ family: "TOTAL", line: 1.5 }];
  assert.throws(() => buildNhlResearchMarkets(f), /FIRST_PERIOD_INPUTS_REQUIRED/);
});
test("separate period evidence produces research-only period outcomes and totals", () => {
  const f = fixture();
  f.firstPeriod = { scoreBasis: "FIRST_PERIOD", provenance: { ...provenance }, cells: [
    { home: 0, away: 0, probability: 0.5 }, { home: 1, away: 0, probability: 0.5 }] };
  f.firstPeriodLines = [{ family: "TOTAL", line: 1 }];
  const r = buildNhlResearchMarkets(f);
  close(r.firstPeriod.outcomes.draw.win, 0.5);
  close(r.firstPeriod.markets[0].selection.push, 0.5);
  assert.equal(r.firstPeriod.canQualify, false);
});
test("kernel cannot inherit qualification or invent uncertainty intervals", () => {
  const f = fixture(); f.regulation.provenance.canQualify = true;
  const r = buildNhlResearchMarkets(f);
  assert.equal(r.canQualify, false); assert.equal(r.canAuthorizeWager, false);
  assert.equal(r.uncertainty.estimationInterval, null);
  assert.equal(r.uncertainty.status, "UNVALIDATED");
  assert.equal(r.fullGame.moneyline.home.canQualify, false);
});
test("repeated runs are deterministic and leave supplied evidence unchanged", () => {
  const f = fixture(), before = structuredClone(f);
  assert.deepEqual(buildNhlResearchMarkets(f), buildNhlResearchMarkets(f));
  assert.deepEqual(f, before);
});
test("all win/lose/push outputs reconcile across half and integer line sweeps", () => {
  const f = fixture(); f.marketLines = [];
  for (let line = 0; line <= 10; line += 0.5) f.marketLines.push({ family: "TOTAL", line });
  for (let line = -5; line <= 5; line += 0.5) f.marketLines.push({ family: "PUCK_LINE", side: "away", line });
  for (const m of buildNhlResearchMarkets(f).fullGame.markets) {
    close(m.selection.win + m.selection.lose + m.selection.push, 1);
    close(m.selection.win + m.opposite.win + m.selection.push, 1);
    close(m.selection.push, m.opposite.push);
  }
});
