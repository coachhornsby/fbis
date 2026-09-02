import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE1_MARKETS,
  PHASE1_OUTSIDE_LABEL,
  MATCH_STATUS,
  CLV_STATUS,
  QUALIFICATION_LABEL,
  matchCanonicalMlbEvent,
  classifyMatchPool,
  matchingHealthCounts,
  packPhase1MarketSnapshot,
  isPhase1FullGameMarket,
  isPhase1ExcludedMarket,
  projectionInvariants,
  clvContractMatch,
  displayPlayLabel,
  recHasMarketAndLine,
  forbiddenSourceSubstitution,
  americanToDecimal,
} from "../functions/lib/mlbPhase1.js";
import { scopeMatches, nextRequestScope } from "../src/lib/requestScope.js";
import { settleExecutedBet, attributeRecommendation, OPERATOR_ONLY } from "../functions/lib/executedBets.js";
import { expectedRoi } from "../functions/lib/pricing.js";
import { expectedRoiMatches } from "../functions/lib/probability.js";
import { CONVICTION_QUALIFICATION_PAUSED, evaluateConvictionGates } from "../functions/lib/convictionGate.js";
import { strategyIntegrity, gradeStrategyResult } from "../functions/lib/strategy.js";
import { scheduledProofNote } from "../functions/lib/endpointTelemetry.js";
import { evaluateProductionSmoke } from "../functions/lib/productionSmoke.js";
import { reconcilePalCounts } from "../functions/lib/sourceCoverage.js";
import { MLB_STATS_ID } from "../functions/lib/mlbCanonical.js";

const cubsSox = {
  canonical: {
    gamePk: 777001,
    start: "2026-09-02T23:20:00Z",
    away: { mlbId: MLB_STATS_ID.CHC, abbr: "CHC" },
    home: { mlbId: MLB_STATS_ID.CHW, abbr: "CHW" },
  },
};

describe("Phase 1 MLB event identity", () => {
  it("matches canonical game ID first", () => {
    const hit = matchCanonicalMlbEvent(
      { gamePk: 777001, away: { abbr: "CHC" }, home: { abbr: "CHW" } },
      cubsSox.canonical
    );
    assert.equal(hit.status, MATCH_STATUS.MATCHED);
    assert.equal(hit.reason, "canonical-game-id");
  });

  it("conflicts when game PKs disagree", () => {
    const hit = matchCanonicalMlbEvent({ gamePk: 9 }, cubsSox.canonical);
    assert.equal(hit.status, MATCH_STATUS.CONFLICT);
  });

  it("matches team IDs with bounded start-time tolerance", () => {
    const hit = matchCanonicalMlbEvent(
      {
        start: "2026-09-02T23:50:00Z",
        away: { mlbId: MLB_STATS_ID.CHC },
        home: { mlbId: MLB_STATS_ID.CHW },
      },
      cubsSox.canonical
    );
    assert.equal(hit.status, MATCH_STATUS.MATCHED);
    assert.equal(hit.reason, "team-ids-start");
  });

  it("does not match solely on abbreviations", () => {
    const hit = matchCanonicalMlbEvent(
      { away: { abbr: "CHC" }, home: { abbr: "CHW" }, start: cubsSox.canonical.start },
      { start: cubsSox.canonical.start, away: { abbr: "CHC" }, home: { abbr: "CHW" } }
    );
    assert.equal(hit.status, MATCH_STATUS.UNMATCHED);
    assert.equal(hit.reason, "abbr-or-name-only-forbidden");
  });

  it("separates doubleheaders by game PK", () => {
    const g1 = matchCanonicalMlbEvent({ gamePk: 1 }, { gamePk: 1, away: { mlbId: 112 }, home: { mlbId: 145 } });
    const g2 = matchCanonicalMlbEvent({ gamePk: 2 }, { gamePk: 1, away: { mlbId: 112 }, home: { mlbId: 145 } });
    assert.equal(g1.status, MATCH_STATUS.MATCHED);
    assert.equal(g2.status, MATCH_STATUS.CONFLICT);
  });

  it("uses reviewed alias mapping as last resort", () => {
    const hit = matchCanonicalMlbEvent(
      { id: "pal-x", away: { name: "Yankees" }, home: { name: "Red Sox" } },
      { gamePk: 88, away: { mlbId: MLB_STATS_ID.NYY }, home: { mlbId: MLB_STATS_ID.BOS } },
      { aliases: [{ sourceEventId: "pal-x", canonicalEventId: "88" }] }
    );
    assert.equal(hit.status, MATCH_STATUS.MATCHED);
    assert.equal(hit.reason, "reviewed-alias");
  });

  it("fails closed on ambiguous pools", () => {
    const pool = classifyMatchPool([
      { status: MATCH_STATUS.MATCHED },
      { status: MATCH_STATUS.MATCHED },
    ]);
    assert.equal(pool.status, MATCH_STATUS.AMBIGUOUS);
    const health = matchingHealthCounts([{ status: "MATCHED" }, { status: "UNMATCHED" }, { status: "CONFLICT" }]);
    assert.equal(health.MATCHED, 1);
    assert.equal(health.CONFLICT, 1);
  });

  it("flags home/away swap as conflict", () => {
    const hit = matchCanonicalMlbEvent(
      {
        start: cubsSox.canonical.start,
        away: { mlbId: MLB_STATS_ID.CHW },
        home: { mlbId: MLB_STATS_ID.CHC },
      },
      cubsSox.canonical
    );
    assert.equal(hit.status, MATCH_STATUS.CONFLICT);
  });
});

describe("Phase 1 market contract", () => {
  it("accepts only full-game ML, run line, and total", () => {
    assert.equal(isPhase1FullGameMarket("ML"), true);
    assert.equal(isPhase1FullGameMarket("SPREAD"), true);
    assert.equal(isPhase1FullGameMarket("TOTAL"), true);
    assert.equal(isPhase1ExcludedMarket("F5 ML"), true);
    assert.equal(isPhase1ExcludedMarket("player prop"), true);
    assert.equal(PHASE1_MARKETS.MONEYLINE, "MLB:FULL_GAME:MONEYLINE");
  });

  it("stores american and decimal prices together", () => {
    const snap = packPhase1MarketSnapshot({
      eventId: "777001",
      marketFamily: "ML",
      selection: "HOME",
      americanPrice: -116,
      book: "Pinnacle",
      observedAt: "2026-09-01T16:00:00Z",
      operatorDate: "2026-09-01",
      homeAwayOrientation: "HOME",
      opposingSelection: "AWAY",
      opposingAmericanPrice: 106,
    });
    assert.equal(snap.periodFamily, "FULL_GAME");
    assert.equal(snap.decimalPrice, americanToDecimal(-116));
    assert.equal(snap.marketCompletenessState, "COMPLETE");
  });

  it("rejects incomplete two-way and invalid odds", () => {
    const incomplete = packPhase1MarketSnapshot({
      eventId: "1",
      marketFamily: "ML",
      selection: "HOME",
      americanPrice: "nope",
      observedAt: "2026-09-01T16:00:00Z",
    });
    assert.equal(incomplete.marketCompletenessState, "INCOMPLETE");
  });

  it("never treats Pal/Kalshi/model fair as sportsbook price", () => {
    assert.equal(forbiddenSourceSubstitution({ displayedAs: "sportsbook price", actualSource: "Kalshi" }), true);
    assert.equal(forbiddenSourceSubstitution({ displayedAs: "Pinnacle close", actualSource: "Heritage current" }), true);
    assert.equal(forbiddenSourceSubstitution({ displayedAs: "Pinnacle close", actualSource: "Pinnacle" }), false);
  });
});

describe("Phase 1 projection invariants and Expected ROI", () => {
  it("requires home/away probabilities to sum to one", () => {
    const bad = projectionInvariants({ pHome: 0.6, pAway: 0.5 });
    assert.equal(bad.ok, false);
    assert.ok(bad.violations.includes("home-away-probability-sum"));
  });

  it("uses the selected moneyline side probability", () => {
    const bad = projectionInvariants({
      pHome: 0.6,
      selectedMarket: "ML",
      selectedSide: "HOME",
      selectedProbability: 0.4,
    });
    assert.ok(bad.violations.includes("ml-side-probability"));
  });

  it("recomputes Expected ROI from selected price", () => {
    const p = 0.592;
    const american = -116;
    const roi = expectedRoi(p, american);
    const inv = projectionInvariants({
      selectedProbability: p,
      selectedPrice: american,
      expectedRoiValue: roi,
    });
    assert.equal(inv.ok, true);
    assert.equal(expectedRoiMatches(roi, p * americanToDecimal(american) - 1), true);
  });
});

describe("Phase 1 settlement", () => {
  const final = (hs, as, extra = {}) => ({
    sport: "mlb",
    status: { completed: true, detail: "Final" },
    home: { score: hs },
    away: { score: as },
    actualHome: hs,
    actualAway: as,
    ...extra,
  });

  it("grades moneyline without a push", () => {
    const won = settleExecutedBet({ market: "ML", selectedSide: "HOME", sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(5, 3));
    assert.equal(won.result, "WON");
    const tie = settleExecutedBet({ market: "ML", selectedSide: "HOME", sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(3, 3));
    assert.equal(tie.result, "OPEN");
    assert.equal(tie.unresolvedReason, "mlb-moneyline-cannot-push");
  });

  it("forbids half-point run line and total pushes", () => {
    const rl = settleExecutedBet({ market: "SPREAD", selectedSide: "HOME", executionLine: -1.5, sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(5, 4));
    assert.notEqual(rl.result, "PUSH");
    const tot = settleExecutedBet({ market: "TOTAL", selectedSide: "OVER", executionLine: 9.5, sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(5, 4));
    assert.notEqual(tot.result, "PUSH");
    const forced = settleExecutedBet({ market: "TOTAL", selectedSide: "OVER", executionLine: 9.5, sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(4.75, 4.75));
    assert.equal(forced.result, "OPEN");
    assert.equal(forced.unresolvedReason, "half-point-cannot-push");
  });

  it("allows whole-number total push only when exact", () => {
    const push = settleExecutedBet({ market: "TOTAL", selectedSide: "OVER", executionLine: 9, sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(5, 4));
    assert.equal(push.result, "PUSH");
    const over = settleExecutedBet({ market: "TOTAL", selectedSide: "OVER", executionLine: 9, sport: "mlb", riskAmount: 10, toWinAmount: 9, potentialPayout: 19 }, final(6, 4));
    assert.equal(over.result, "WON");
  });

  it("keeps postponed and missing finals unresolved", () => {
    const ppd = settleExecutedBet({ market: "ML", selectedSide: "HOME", sport: "mlb", riskAmount: 10 }, { status: { detail: "Postponed" } });
    assert.equal(ppd.result, "POSTPONED");
    const missing = settleExecutedBet({ market: "ML", selectedSide: "HOME", sport: "mlb", riskAmount: 10 }, { status: { completed: false, detail: "In Progress" }, home: { score: 2 }, away: { score: 1 } });
    assert.equal(missing.result, "OPEN");
  });

  it("grades strategy ML the same way", () => {
    const g = gradeStrategyResult({ market: "ML", side: "HOME", sport: "mlb", executionPrice: -110, stake: 1 }, final(4, 2));
    assert.equal(g.result, "WON");
    const tie = gradeStrategyResult({ market: "ML", side: "HOME", sport: "mlb", executionPrice: -110 }, final(2, 2));
    assert.equal(tie, null);
  });
});

describe("Heritage attribution and CLV contract", () => {
  it("does not attribute a Heritage bet without matching freeze/period/line", () => {
    const attr = attributeRecommendation(
      { gameId: "g1", market: "TOTAL", selectedSide: "OVER", period: "FULL_GAME", executionLine: 9.5, executedAt: "2026-09-01T16:00:00Z", start: "2026-09-01T23:00:00Z" },
      {
        snapshots: [{ gameId: "g1", frozenAt: "2026-09-01T15:00:00Z", projHome: 4 }],
        strategyTickets: [{ id: "s1", gameId: "g1", market: "TOTAL", side: "OVER", period: "FULL_GAME", line: 8.5, tag: "CONVICTION", qualified: true, qualifiedAt: "2026-09-01T15:01:00Z" }],
      }
    );
    assert.equal(attr.label, OPERATOR_ONLY);
  });

  it("attributes only when freeze is before execution and start", () => {
    const attr = attributeRecommendation(
      { gameId: "g1", market: "ML", selectedSide: "HOME", period: "FULL_GAME", executedAt: "2026-09-01T16:00:00Z", start: "2026-09-01T23:00:00Z" },
      {
        snapshots: [{ gameId: "g1", frozenAt: "2026-09-01T15:00:00Z", projHome: 4 }],
        strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "HOME", period: "FULL_GAME", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-09-01T15:01:00Z" }],
      }
    );
    assert.equal(attr.conviction, true);
  });

  it("computes same-contract CLV and rejects line mismatch", () => {
    const ok = clvContractMatch({
      entryEventId: "1",
      closeEventId: "1",
      entryMarket: "TOTAL",
      closeMarket: "TOTAL",
      entryPeriod: "FULL_GAME",
      closePeriod: "FULL_GAME",
      entrySelection: "OVER",
      closeSelection: "OVER",
      entryLine: 9.5,
      closeLine: 9.5,
      entryNoVig: 0.48,
      closeNoVig: 0.51,
    });
    assert.equal(ok.status, CLV_STATUS.PRICE_SAME_LINE);
    assert.ok(Math.abs(ok.clv - 0.03) < 1e-12);
    const mismatch = clvContractMatch({
      ...ok,
      entryEventId: "1",
      closeEventId: "1",
      entryMarket: "TOTAL",
      closeMarket: "TOTAL",
      entrySelection: "OVER",
      closeSelection: "OVER",
      entryLine: 9.5,
      closeLine: 8.5,
      entryNoVig: 0.48,
      closeNoVig: 0.51,
    });
    assert.equal(mismatch.status, CLV_STATUS.LINE_MISMATCH);
  });
});

describe("Qualification pause, canary isolation, and integrity zeros", () => {
  it("keeps CONVICTION paused", () => {
    assert.equal(CONVICTION_QUALIFICATION_PAUSED, true);
    const gate = evaluateConvictionGates({ candidate: { qualified: true, fair: 0.6, pinPrice: -110, implied: 0.52, market: "ML", side: "HOME", qualifiedAt: "2026-09-01T12:00:00Z", modelVersion: "FBIS-v1.3", checkpoint: "LATEST" }, frozen: { pHomeFinal: 0.6, frozenAt: "2026-09-01T12:00:00Z", start: "2026-09-01T23:00:00Z", checkpoint: "LATEST", modelVersion: "FBIS-v1.3" }, canaryPassed: false });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "qualification-paused");
  });

  it("labels paused recs QUALIFICATION PAUSED, never silent CONVICTION", () => {
    assert.equal(displayPlayLabel({ rec: { tag: "CONVICTION" }, paused: true }), QUALIFICATION_LABEL.QUALIFICATION_PAUSED);
    assert.equal(displayPlayLabel({ canary: true }), QUALIFICATION_LABEL.CANARY);
    assert.equal(PHASE1_OUTSIDE_LABEL.includes("Phase 1"), true);
  });

  it("requires market and line on a recommendation", () => {
    assert.equal(recHasMarketAndLine({ pick: "Cubs", market: "" }), false);
    assert.equal(recHasMarketAndLine({ pick: "Cubs", market: "SPREAD" }), false);
    assert.equal(recHasMarketAndLine({ pick: "Cubs -1.5", market: "SPREAD", line: -1.5 }), true);
  });

  it("counts original missing probability as quarantined", () => {
    const rows = Array.from({ length: 172 }, (_, i) => ({ id: `t${i}`, sport: "mlb", market: "ML", result: "OPEN" }));
    const integrity = strategyIntegrity(rows, { reconstructions: rows.slice(0, 162).map((t) => ({ originalTicketId: t.id, status: "RECOVERED_VERIFIED" })) });
    assert.equal(integrity.quarantined, 172);
    assert.notEqual(integrity.quarantined, 0);
    assert.equal(integrity.originalProbabilityMissing, 172);
  });
});

describe("Request scope, Pal reconcile, scheduled proof, smoke", () => {
  it("drops a late NFL response when NBA is active", () => {
    const ref = { current: { seq: 0 } };
    const nfl = nextRequestScope(ref, { sport: "nfl", date: "2026-09-02", page: "today" });
    const nba = nextRequestScope(ref, { sport: "nba", date: "2026-09-02", page: "today" });
    assert.equal(scopeMatches(ref.current, nfl, { responseSport: "nfl" }), false);
    assert.equal(scopeMatches(ref.current, nba, { responseSport: "nba", responseDate: "2026-09-02" }), true);
  });

  it("explains Pal summary vs per-game disagreement instead of zeroing", () => {
    const rec = reconcilePalCounts({ summaryMatched: 12, summaryUnmatched: 0, perGameMatched: 10, perGameUnmatched: 2 });
    assert.equal(rec.consistent, false);
    assert.match(rec.message, /disagrees/);
    assert.equal(rec.matched, 10);
  });

  it("distinguishes scheduled GitHub success from durable D1 proof", () => {
    const note = scheduledProofNote({ collectState: "healthy", lastEventType: "schedule", lastRunUrl: "https://example", durableScheduleRow: false });
    assert.match(note, /unverified|not collection proof|no matching durable/i);
    const ok = scheduledProofNote({ collectState: "healthy", lastEventType: "schedule", lastRunUrl: "https://example", durableScheduleRow: true });
    assert.match(ok, /agree/);
  });

  it("fails smoke on placeholder zeros and SHA mismatch", () => {
    const smoke = evaluateProductionSmoke({
      expectedSha: "a".repeat(40),
      health: {
        deploymentCommit: "b".repeat(40),
        build: { migrationStatus: "VERIFIED", schemaVersion: "0013_probability_integrity" },
        d1: { writeVerification: "VERIFIED", readOk: true },
        convictionQualificationPaused: true,
      },
      today: { games: [{ sport: "mlb" }], date: "2026-09-02" },
      bets: { summary: { open: 9 } },
      strategy: { convictionQualification: { paused: true }, integrity: { invalid: 0, quarantined: 0, originalProbabilityMissing: 172 }, historicalProbabilityReconstruction: { recoveredVerifiedN: 162 } },
    });
    assert.equal(smoke.ok, false);
    assert.ok(smoke.failures.includes("sha-mismatch"));
    assert.ok(smoke.failures.includes("placeholder-zero-under-unavailable") || smoke.failures.includes("integrity-zero-while-quarantined"));
  });

  it("does not treat unavailable as a legitimate zero when pause is missing", () => {
    const smoke = evaluateProductionSmoke({
      expectedSha: "a".repeat(40),
      health: {
        deploymentCommit: "a".repeat(40),
        build: { migrationStatus: "VERIFIED", schemaVersion: "0013_probability_integrity" },
        d1: { writeVerification: "VERIFIED", readOk: true },
      },
      today: { games: [] },
      bets: { summary: { open: 0 } },
      strategy: { convictionQualification: { paused: false }, integrity: {} },
    });
    assert.ok(smoke.failures.includes("pause-not-reported"));
  });
});
