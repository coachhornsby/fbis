import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRawProbability,
  expectedRoiMatches,
  formatExpectedRoiPct,
  formatModelProbabilityPct,
  normalizeModelProbability,
  parseFiniteNumber,
  PROBABILITY_UNITS,
  readCanonicalProbability,
  validateCanonicalProbability,
} from "../functions/lib/probability.js";
import { expectedRoi } from "../functions/lib/pricing.js";
import { auditTicketEv } from "../functions/lib/evAudit.js";
import { CONVICTION_PAUSE_MESSAGE, CONVICTION_QUALIFICATION_PAUSED, evaluateConvictionGates } from "../functions/lib/convictionGate.js";
import {
  reconstructTicketProbability,
  RECONSTRUCTION_STATUS,
  sept1CohortLabel,
  summarizeReconstructions,
  UNRECOVERED_SEED_RECORD,
} from "../functions/lib/probabilityReconstruction.js";
import { persistStrategyTicketWithReadback } from "../functions/lib/store.js";
import { packTicket, summarizeProspectiveConvictionCohort, gradeStrategyResult } from "../functions/lib/strategy.js";
import { settleExecutedBet } from "../functions/lib/executedBets.js";
import { classifyHealthResponse, nextVerifyDelayMs, shouldFailClosed, collectionAllowedAfterVerify, VERIFY_OUTCOME } from "../functions/lib/deploymentVerify.js";
import { buildCfbFeatureVector, summarizeCfbEvidenceCoverage, cfbBettingAllowed, PROJECTION_STATES } from "../functions/lib/cfbModel.js";
import { parseCoachTenure, buildCfbFeatureCatalog } from "../functions/lib/cfbd.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";
import { selectPipelineJob } from "../functions/lib/pipelineSchedule.js";

describe("canonical probability contract", () => {
  it("rejects null, empty string, non-numeric, 0, 1, out of range, NaN, Inf", () => {
    assert.equal(validateCanonicalProbability(null).ok, false);
    assert.equal(validateCanonicalProbability("").ok, false);
    assert.equal(validateCanonicalProbability("abc").ok, false);
    assert.equal(validateCanonicalProbability(0).ok, false);
    assert.equal(validateCanonicalProbability(1).ok, false);
    assert.equal(validateCanonicalProbability(-0.1).ok, false);
    assert.equal(validateCanonicalProbability(1.01).ok, false);
    assert.equal(validateCanonicalProbability(57.2).ok, false);
    assert.equal(validateCanonicalProbability(Number.NaN).ok, false);
    assert.equal(validateCanonicalProbability(Number.POSITIVE_INFINITY).ok, false);
  });

  it("accepts a string decimal and rejects automatic percent conversion", () => {
    const parsed = validateCanonicalProbability("0.572");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.modelProbability, 0.572);
    const asPct = normalizeModelProbability(57.2, { sourceUnits: PROBABILITY_UNITS.DECIMAL });
    assert.equal(asPct.ok, false);
    const explicit = normalizeModelProbability(57.2, { sourceUnits: PROBABILITY_UNITS.PERCENT });
    assert.equal(explicit.ok, true);
    assert.ok(Math.abs(explicit.modelProbability - 0.572) < 1e-12);
  });

  it("never converts missing probability to zero", () => {
    const parsed = parseFiniteNumber(null);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.value, null);
    assert.notEqual(parsed.value, 0);
    assert.equal(classifyRawProbability(null), "null");
    assert.equal(classifyRawProbability(""), "empty-string");
  });

  it("formats percentage only at the UI boundary", () => {
    assert.ok(Math.abs(formatModelProbabilityPct(0.572) - 57.2) < 1e-9);
    assert.equal(formatExpectedRoiPct(0.08), 8);
    assert.equal(formatModelProbabilityPct(57.2), null);
  });

  it("reads the same canonical field used by qualification and audit", () => {
    const ticket = { modelProbability: 0.61, traits: { fair: 57.2 }, fair: 57.2 };
    const read = readCanonicalProbability(ticket);
    assert.equal(read.ok, true);
    assert.equal(read.modelProbability, 0.61);
    const audit = auditTicketEv({ ...ticket, pinPrice: -110, ev: expectedRoi(0.61, -110), entryNoVig: 0.52 });
    assert.equal(audit.reasons.includes("probability-out-of-range"), false);
    assert.equal(audit.inputs.fair, 0.61);
  });
});

describe("Expected ROI formula and units", () => {
  it("uses decimal probability, not a percentage such as 57.2", () => {
    const roi = expectedRoi(0.572, -110);
    assert.ok(roi != null);
    assert.equal(expectedRoi(57.2, -110), null);
    const american = -110;
    const profit = 100 / 110;
    const expected = 0.572 * profit - (1 - 0.572);
    assert.ok(Math.abs(roi - expected) < 1e-12);
    assert.equal(expectedRoiMatches(roi, expected), true);
  });
});

describe("strategy insertion fail closed", () => {
  it("requires a canary before enabling CONVICTION qualification", () => {
    assert.equal(CONVICTION_QUALIFICATION_PAUSED, false);
    const gate = evaluateConvictionGates({
      candidate: {
        qualified: true,
        lean: false,
        modelProbability: 0.61,
        pinPrice: -110,
        marketComplete: true,
        implied: 0.52,
        market: "ML",
        side: "HOME",
        checkpoint: "MORNING",
        qualifiedAt: "2026-09-02T12:00:00.000Z",
        start: "2026-09-02T23:00:00.000Z",
        modelVersion: "FBIS-v1.3",
        ev: expectedRoi(0.61, -110),
      },
      frozen: { checkpoint: "MORNING", frozenAt: "2026-09-02T12:00:00.000Z", start: "2026-09-02T23:00:00.000Z" },
      game: { start: "2026-09-02T23:00:00.000Z" },
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "qualification-paused");
    assert.ok(gate.reasons[0].includes(CONVICTION_PAUSE_MESSAGE));
    const open = evaluateConvictionGates({
      candidate: {
        qualified: true,
        lean: false,
        modelProbability: 0.61,
        pinPrice: -110,
        marketComplete: true,
        implied: 0.52,
        market: "ML",
        side: "HOME",
        checkpoint: "MORNING",
        qualifiedAt: "2026-09-02T12:00:00.000Z",
        start: "2026-09-02T23:00:00.000Z",
        modelVersion: "FBIS-v1.3",
        qualificationRuleVersion: "FBIS-HC-v1",
        ev: expectedRoi(0.61, -110),
      },
      frozen: {
        checkpoint: "MORNING",
        frozenAt: "2026-09-02T12:00:00.000Z",
        start: "2026-09-02T23:00:00.000Z",
        pHomeFinal: 0.61,
      },
      game: { start: "2026-09-02T23:00:00.000Z" },
      paused: false,
      canaryPassed: true,
    });
    assert.equal(open.ok, true);
    assert.equal(open.modelProbability, 0.61);
  });

  it("displays live CONVICTION candidates when the emergency pause is off", () => {
    const bundle = recommendBundle(
      "mlb",
      {
        home: { name: "A" },
        away: { name: "B" },
        odds: { pinHomeMl: -110, pinAwayMl: -110, heritageListed: true, heritageHomeMl: -110, heritageAwayMl: -110 },
        pin: { ml: { complete: true, noVigA: 0.5, noVigB: 0.5, priceA: -110, priceB: -110, vig: 0.048 } },
      },
      { layers: { score: 0.62 } }
    );
    assert.equal(bundle.qualified?.tag, "CONVICTION");
    assert.equal(bundle.qualificationPaused, undefined);
  });

  it("fails closed when post-insert readback cannot validate probability", async () => {
    const packed = packTicket(
      {
        qualified: true,
        sport: "mlb",
        gameId: "readback-fail",
        market: "ML",
        side: "HOME",
        ev: 0.12,
        tag: "CONVICTION",
        pinPrice: -110,
        modelProbability: 0.61,
        modelVersion: "FBIS-v1.3",
        qualifiedAt: "2026-09-02T12:00:00.000Z",
      },
      { role: "prospective", date: "2026-09-02" }
    );
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async run() {
                  return { meta: { changes: 1 } };
                },
                async first() {
                  return {
                    id: packed.id,
                    strategy_id: packed.strategyId,
                    role: packed.role,
                    traits_json: JSON.stringify({}),
                    ev: packed.ev,
                    pin_price: -110,
                  };
                },
                async all() {
                  return { results: [] };
                },
              };
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      },
    };
    const out = await persistStrategyTicketWithReadback(env, packed);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "readback-validation-failed");
    assert.equal(out.exposed, false);
  });
});

describe("immutable historical reconstruction", () => {
  it("reconstructs ML probability from frozen pregame p_home_final", () => {
    const ticket = {
      id: "mlb:2026-09-01:1:ML:HOME",
      gameId: "1",
      market: "ML",
      side: "HOME",
      pinPrice: -110,
      modelVersion: "FBIS-v1.3",
    };
    const snap = {
      gameId: "1",
      pHomeFinal: 0.58,
      frozenAt: "2026-09-01T12:00:00.000Z",
      start: "2026-09-01T23:10:00.000Z",
      modelVersion: "FBIS-v1.3",
    };
    const out = reconstructTicketProbability(ticket, snap);
    assert.equal(out.status, RECONSTRUCTION_STATUS.RECOVERED_VERIFIED);
    assert.equal(out.reconstructedModelProbability, 0.58);
  });

  it("marks tickets without frozen projection unrecoverable", () => {
    const out = reconstructTicketProbability({ id: "x", gameId: "missing", market: "ML", side: "HOME" }, null);
    assert.equal(out.status, RECONSTRUCTION_STATUS.UNRECOVERABLE);
  });

  it("blocks spread reconstruction when market probability was not frozen", () => {
    const out = reconstructTicketProbability(
      { id: "s", gameId: "1", market: "SPREAD", side: "HOME", modelVersion: "FBIS-v1.3" },
      { gameId: "1", pHomeFinal: 0.58, frozenAt: "2026-09-01T12:00:00.000Z", start: "2026-09-01T23:00:00.000Z", modelVersion: "FBIS-v1.3" }
    );
    assert.equal(out.status, RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED);
  });

  it("does not mutate the original probability field", () => {
    const ticket = { id: "t", gameId: "1", market: "ML", side: "AWAY", fair: null };
    const snap = { gameId: "1", pHomeFinal: 0.58, frozenAt: "2026-09-01T12:00:00.000Z", start: "2026-09-01T23:00:00.000Z" };
    reconstructTicketProbability(ticket, snap);
    assert.equal(ticket.fair, null);
  });

  it("uses an independent pregame start when the snapshot omitted start", () => {
    const ticket = {
      id: "mlb:2026-09-01:1:ML:AWAY",
      gameId: "1",
      market: "ML",
      side: "AWAY",
      pinPrice: -110,
      modelVersion: "FBIS-v1.3",
    };
    const snap = {
      gameId: "1",
      pHomeFinal: 0.42,
      frozenAt: "2026-09-01T12:00:00.000Z",
      modelVersion: "FBIS-v1.3",
    };
    const blocked = reconstructTicketProbability(ticket, snap);
    assert.equal(blocked.status, RECONSTRUCTION_STATUS.RECONSTRUCTION_BLOCKED);
    const out = reconstructTicketProbability(ticket, snap, { gameStart: "2026-09-01T23:10:00.000Z" });
    assert.equal(out.status, RECONSTRUCTION_STATUS.RECOVERED_VERIFIED);
    assert.ok(Math.abs(out.reconstructedModelProbability - 0.58) < 1e-12);
  });
});

describe("September 1 cohort labels", () => {
  it("labels results recovered 5-2 with unresolved probability", () => {
    const label = sept1CohortLabel({ recoveredN: 7, wins: 5, losses: 2, probabilityVerifiedN: 0, settledN: 7 });
    assert.equal(
      label,
      "Operator reported 5–2; results recovered 5–2; probability integrity unresolved; excluded from calculated FBIS-HC-v1 performance"
    );
  });

  it("labels a fully verified 5-2 cohort", () => {
    const reconstructions = Array.from({ length: 7 }, (_, i) => ({
      originalTicketId: `p-${i + 1}`,
      status: RECONSTRUCTION_STATUS.RECOVERED_VERIFIED,
      reconstructedModelProbability: 0.58,
    }));
    const rows = reconstructions.map((r, i) => ({
      id: r.originalTicketId,
      role: "prospective",
      tag: "CONVICTION",
      gameId: `g-${i}`,
      market: "ML",
      side: "HOME",
      ev: 0.12,
      modelVersion: "m1",
      qualifiedAt: "2026-09-01T12:00:00.000Z",
      result: i < 5 ? "WON" : "LOST",
      stake: 1,
      profit: i < 5 ? 0.9 : -1,
    }));
    const out = summarizeProspectiveConvictionCohort(rows, {
      targetDateCt: "2026-09-01",
      expectedN: 7,
      reconstructions,
    });
    assert.equal(out.label, "Prospective CONVICTION cohort: 5–2, N=7");
    assert.equal(out.eligibleForCalculatedFbisHcV1, true);
    assert.equal(out.mergedWithUnrecoveredSeed, false);
  });

  it("never merges with unrecovered 7-0", () => {
    assert.equal(UNRECOVERED_SEED_RECORD, "7-0");
    const summary = summarizeReconstructions([]);
    assert.equal(summary.recoveredVerifiedN, 0);
    const label = sept1CohortLabel({ recoveredN: 7, wins: 5, losses: 2, probabilityVerifiedN: 7, settledN: 7 });
    assert.equal(label.includes("7–0"), false);
    assert.equal(label.includes("12"), false);
  });
});

describe("settlement rules", () => {
  const game = (hs, as, sport = "mlb") => ({
    sport,
    status: { completed: true, detail: "Final" },
    home: { score: hs },
    away: { score: as },
  });

  it("does not allow MLB moneyline to push", () => {
    const settled = settleExecutedBet({ market: "ML", selectedSide: "HOME", sport: "mlb", riskAmount: 1, toWinAmount: 1 }, game(3, 3));
    assert.equal(settled.result, "OPEN");
    assert.equal(gradeStrategyResult({ market: "ML", side: "HOME", sport: "mlb" }, game(3, 3)), null);
  });

  it("does not allow half-point spread or total to push", () => {
    const spread = settleExecutedBet(
      { market: "SPREAD", selectedSide: "HOME", executionLine: -1.5, sport: "mlb", riskAmount: 1, toWinAmount: 1 },
      game(5, 3.5)
    );
    assert.notEqual(spread.result, "PUSH");
    const total = settleExecutedBet(
      { market: "TOTAL", selectedSide: "OVER", executionLine: 8.5, sport: "mlb", riskAmount: 1, toWinAmount: 1 },
      game(4, 4.5)
    );
    assert.notEqual(total.result, "PUSH");
  });

  it("allows whole-number total push only when exact", () => {
    const push = settleExecutedBet(
      { market: "TOTAL", selectedSide: "OVER", executionLine: 9, sport: "mlb", riskAmount: 2, toWinAmount: 1.8 },
      game(4, 5)
    );
    assert.equal(push.result, "PUSH");
    const won = settleExecutedBet(
      { market: "TOTAL", selectedSide: "OVER", executionLine: 9, sport: "mlb", riskAmount: 2, toWinAmount: 1.8 },
      game(6, 5)
    );
    assert.equal(won.result, "WON");
  });

  it("uses first-five scores for F5 markets", () => {
    const settled = settleExecutedBet(
      { market: "F5 ML", selectedSide: "HOME", sport: "mlb", riskAmount: 1, toWinAmount: 1 },
      { ...game(1, 8), f5Score: { home: 4, away: 1, complete: true } }
    );
    assert.equal(settled.result, "WON");
  });

  it("keeps missing finals unresolved", () => {
    const settled = settleExecutedBet(
      { market: "ML", selectedSide: "HOME", sport: "mlb" },
      { status: { completed: false, detail: "In Progress" }, home: { score: 2 }, away: { score: 1 } }
    );
    assert.equal(settled.result, "OPEN");
  });

  it("settles a matched Heritage moneyline from final-score evidence", () => {
    const settled = settleExecutedBet(
      { market: "ML", selectedSide: "AWAY", sport: "mlb", riskAmount: 2.1, toWinAmount: 2 },
      game(1, 5)
    );
    assert.equal(settled.result, "WON");
    assert.equal(settled.profit, 2);
  });
});

describe("scheduled SHA verification", () => {
  it("retries propagation separately from mismatch", () => {
    const unavailable = classifyHealthResponse({ httpStatus: 503, contentType: "text/plain", expectedSha: "a".repeat(40) });
    assert.equal(unavailable.outcome, VERIFY_OUTCOME.UNAVAILABLE);
    assert.equal(unavailable.retryable, true);
    const propagating = classifyHealthResponse({
      httpStatus: 200,
      contentType: "application/json",
      json: { ok: true, deploymentCommit: null },
      expectedSha: "a".repeat(40),
    });
    assert.equal(propagating.outcome, VERIFY_OUTCOME.PROPAGATING);
    const mismatch = classifyHealthResponse({
      httpStatus: 200,
      contentType: "application/json",
      json: { ok: true, deploymentCommit: "b".repeat(40) },
      expectedSha: "a".repeat(40),
    });
    assert.equal(mismatch.outcome, VERIFY_OUTCOME.MISMATCH);
    assert.equal(shouldFailClosed(mismatch, { attempts: 3, maxAttempts: 12 }), true);
    assert.equal(shouldFailClosed(propagating, { attempts: 2, maxAttempts: 12 }), false);
    assert.equal(shouldFailClosed(propagating, { attempts: 12, maxAttempts: 12 }), false);
    assert.equal(shouldFailClosed(unavailable, { attempts: 12, maxAttempts: 12 }), false);
    assert.equal(collectionAllowedAfterVerify(unavailable), true);
    assert.equal(collectionAllowedAfterVerify(propagating), true);
    assert.equal(collectionAllowedAfterVerify(mismatch), false);
    assert.ok(nextVerifyDelayMs(2, { outcome: VERIFY_OUTCOME.PROPAGATING }) > nextVerifyDelayMs(2, { outcome: VERIFY_OUTCOME.MISMATCH }));
  });

  it("selects harvest at 16:20 UTC after morning collect-full", () => {
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 0, eventName: "schedule" }).job, "collect-full");
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 20, eventName: "schedule" }).job, "harvest");
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 20, eventName: "schedule" }).trigger, "schedule");
  });
});

describe("CFB missing evidence remains null", () => {
  it("does not zero-fill missing EPA or coaching", () => {
    const fv = buildCfbFeatureVector({ name: "Unknown", espnId: "999999" }, { featureCatalog: { byEspnId: {}, bySchool: {} }, qbSignals: {} });
    assert.ok(fv.missing.includes("epa_missing"));
    assert.ok(fv.missing.includes("coaching_missing"));
    assert.equal(fv.components.epa, null);
    assert.equal(fv.components.coaching, null);
  });

  it("does not qualify on incomplete evidence", () => {
    assert.equal(cfbBettingAllowed(PROJECTION_STATES.PARTIAL, { teamSpecificPrior: true }, { teamSpecificPrior: true }), false);
    const coverage = summarizeCfbEvidenceCoverage([
      {
        qualificationBlocked: true,
        odds: {},
        cfb: {
          bettingAllowed: false,
          projectionState: "PRIOR_ONLY",
          homeEst: { featureVector: { missing: ["epa_missing", "coaching_missing"] } },
          awayEst: { featureVector: { missing: ["epa_missing", "coaching_missing"] } },
        },
      },
    ]);
    assert.equal(coverage.qualificationReady, false);
    assert.equal(coverage.missing.epa_missing, 2);
  });

  it("parses CFBD hireDate into coaching tenure", () => {
    const tenure = parseCoachTenure({ hireDate: "2019-12-01T00:00:00.000Z" }, 2026);
    assert.equal(tenure, 7);
    const catalog = buildCfbFeatureCatalog({
      year: 2026,
      coaches: [{ team: "Ohio State", firstName: "Ryan", lastName: "Day", hireDate: "2018-12-04T00:00:00.000Z" }],
    });
    assert.equal(catalog.byEspnId["194"].coachTenure, 8);
    assert.equal(catalog.byEspnId["194"].newCoach, false);
    const priorSeason = buildCfbFeatureCatalog({
      year: 2026,
      coachSeasonYear: 2025,
      coaches: [
        {
          firstName: "Ryan",
          lastName: "Day",
          hireDate: "2018-12-04T00:00:00.000Z",
          team: "Ohio State",
          seasons: [
            { school: "Ohio State", year: 2019 },
            { school: "Ohio State", year: 2025 },
          ],
        },
      ],
    });
    assert.equal(priorSeason.byEspnId["194"].coachTenure, 8);
    assert.equal(priorSeason.byEspnId["194"].coachFirstYear, 2018);
  });
});
