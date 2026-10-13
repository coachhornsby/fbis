import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TRACKER_EXECUTED_AT_PROVENANCE,
  applyValidatedTrackerReceiptClock,
  chicagoWallToUtcIso,
  hasExplicitTimezone,
  isAuthenticTrackerReceiptClock,
  isSyntheticTrackerNoon,
  parseTrackerPlacedAt,
  resolveTrackerExecutedAt,
  shouldRepairSyntheticTrackerClock,
  trackerCalibrationEligibility,
} from "../functions/lib/trackerReceiptClock.js";
import { trackerTicket } from "../services/sports-projection-orchestrator/orchestrator.mjs";
import { trackerImmutableConflictFields } from "../functions/api/bets.js";

test("explicit timezone requires Z or numeric offset — bare T is not UTC", () => {
  assert.equal(hasExplicitTimezone("2026-10-10T14:30:00.000Z"), true);
  assert.equal(hasExplicitTimezone("2026-10-10T14:30:00-05:00"), true);
  assert.equal(hasExplicitTimezone("2026-10-10T14:30:00+00:00"), true);
  assert.equal(hasExplicitTimezone("2026-10-10T14:30"), false);
  assert.equal(hasExplicitTimezone("2026-10-10 14:30"), false);
});

test("Central-to-UTC conversion for timezone-less and explicitly offset stamps", () => {
  // 14:30 CDT (UTC-5 in October) → 19:30 UTC
  assert.equal(parseTrackerPlacedAt("2026-10-10T14:30")?.iso, "2026-10-10T19:30:00.000Z");
  assert.equal(parseTrackerPlacedAt("2026-10-10 14:30")?.iso, "2026-10-10T19:30:00.000Z");
  assert.equal(parseTrackerPlacedAt("2026-10-10T14:30:00-05:00")?.iso, "2026-10-10T19:30:00.000Z");
  assert.equal(parseTrackerPlacedAt("2026-10-10T14:30:00.000Z")?.iso, "2026-10-10T14:30:00.000Z");
  assert.equal(chicagoWallToUtcIso(2026, 10, 10, 14, 30, 0), "2026-10-10T19:30:00.000Z");
});

test("preserves seconds on wall-clock and offset inputs", () => {
  assert.equal(parseTrackerPlacedAt("2026-10-10 14:30:45")?.iso, "2026-10-10T19:30:45.000Z");
  assert.equal(parseTrackerPlacedAt("2026-10-10T14:30:45")?.iso, "2026-10-10T19:30:45.000Z");
  assert.equal(parseTrackerPlacedAt("2026-10-10T14:30:45.000Z")?.iso, "2026-10-10T14:30:45.000Z");
  assert.equal(chicagoWallToUtcIso(2026, 10, 10, 14, 30, 45), "2026-10-10T19:30:45.000Z");
});

test("rejects invalid dates, DST spring-forward gaps, and ambiguous fall-back walls", () => {
  assert.equal(parseTrackerPlacedAt("2026-02-30 14:30"), null);
  assert.equal(chicagoWallToUtcIso(2026, 2, 30, 14, 30, 0), null);
  // US DST starts 2026-03-08 02:00 → 03:00; 02:30 does not exist in Chicago.
  assert.equal(parseTrackerPlacedAt("2026-03-08 02:30"), null);
  assert.equal(chicagoWallToUtcIso(2026, 3, 8, 2, 30, 0), null);
  // US DST ends 2026-11-01; 01:30 is ambiguous without an offset.
  assert.equal(parseTrackerPlacedAt("2026-11-01 01:30"), null);
  assert.equal(chicagoWallToUtcIso(2026, 11, 1, 1, 30, 0), null);
  assert.equal(parseTrackerPlacedAt("2026-10-10"), null);
  assert.equal(parseTrackerPlacedAt(""), null);
});

test("rejects invalid absolute-ISO calendar dates (Z and numeric offset) — no Date.parse overflow", () => {
  // Date.parse would normalize these; the receipt-clock path must reject instead.
  assert.equal(parseTrackerPlacedAt("2026-02-30T14:30:00Z"), null);
  assert.equal(parseTrackerPlacedAt("2026-02-30T14:30:00.000Z"), null);
  assert.equal(parseTrackerPlacedAt("2026-02-29T14:30:00-05:00"), null); // 2026 is not a leap year
  assert.equal(parseTrackerPlacedAt("2026-02-29T14:30:00Z"), null);
  assert.equal(parseTrackerPlacedAt("2026-13-01T14:30:00Z"), null);
  assert.equal(parseTrackerPlacedAt("2026-04-31T14:30:00Z"), null);
  // Valid absolute ISO still accepted.
  assert.equal(parseTrackerPlacedAt("2026-02-28T14:30:00Z")?.iso, "2026-02-28T14:30:00.000Z");
  assert.equal(parseTrackerPlacedAt("2024-02-29T14:30:00Z")?.iso, "2024-02-29T14:30:00.000Z"); // leap year
});

test("resolveTrackerExecutedAt prefers Placed At and marks synthetic noon non-prospective", () => {
  const auth = resolveTrackerExecutedAt({
    date: "2026-10-10",
    placedAtRaw: "2026-10-10T18:05:00.000Z",
  });
  assert.equal(auth.executedAt, "2026-10-10T18:05:00.000Z");
  assert.equal(auth.provenance, TRACKER_EXECUTED_AT_PROVENANCE.TRACKER_PLACED_AT);
  assert.equal(auth.prospectiveProofEligible, true);
  assert.equal(isAuthenticTrackerReceiptClock(auth.provenance), true);
  // Sheet Placed At is not independent sportsbook receipt proof for calibration/CLV.
  assert.equal(trackerCalibrationEligibility(auth.provenance), "INELIGIBLE - TRACKER SYNC UNVERIFIED");

  const syn = resolveTrackerExecutedAt({ date: "2026-10-10", placedAtRaw: "" });
  assert.equal(syn.executedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(syn.provenance, TRACKER_EXECUTED_AT_PROVENANCE.SYNTHETIC_DATE_NOON);
  assert.equal(syn.prospectiveProofEligible, false);
  assert.equal(isSyntheticTrackerNoon(syn.executedAt, "2026-10-10"), true);
  assert.match(trackerCalibrationEligibility(syn.provenance), /SYNTHETIC_RECEIPT_CLOCK/);
});

test("caller-supplied authenticity flags cannot upgrade missing Placed At", () => {
  const poisoned = applyValidatedTrackerReceiptClock({
    date: "2026-10-10",
    executedAt: "2026-10-10T18:00:00.000Z",
    trackerMetadata: {
      placedAt: "",
      executedAtProvenance: "tracker-placed-at",
      prospectiveProofEligible: true,
      calibrationEligibility: "ELIGIBLE",
      placedAtIso: "2026-10-10T18:00:00.000Z",
    },
  });
  assert.equal(poisoned.executedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(poisoned.trackerMetadata.executedAtProvenance, "synthetic-date-noon");
  assert.equal(poisoned.trackerMetadata.prospectiveProofEligible, false);
  assert.equal(poisoned.trackerMetadata.placedAtIso, null);
  assert.match(poisoned.trackerMetadata.calibrationEligibility, /SYNTHETIC_RECEIPT_CLOCK/);

  const contradictory = applyValidatedTrackerReceiptClock({
    date: "2026-10-10",
    trackerMetadata: {
      placedAt: "not-a-timestamp",
      executedAtProvenance: "tracker-placed-at",
      prospectiveProofEligible: true,
    },
  });
  assert.equal(contradictory.trackerMetadata.executedAtProvenance, "synthetic-date-noon");
  assert.equal(contradictory.trackerMetadata.prospectiveProofEligible, false);
});

test("one-way repair only replaces synthetic noon with authenticated Placed At", () => {
  const prior = {
    date: "2026-10-10",
    executedAt: "2026-10-10T12:00:00.000Z",
    executionLine: -3.5,
    executionPrice: -110,
    riskAmount: 2,
    selectedSide: "HOME",
    trackerMetadata: { executedAtProvenance: "synthetic-date-noon" },
  };
  const next = resolveTrackerExecutedAt({
    date: "2026-10-10",
    placedAtRaw: "2026-10-10T20:15:00.000Z",
  });
  assert.equal(shouldRepairSyntheticTrackerClock(prior, { ...next, date: "2026-10-10" }), true);

  const alreadyAuth = {
    ...prior,
    executedAt: "2026-10-10T20:15:00.000Z",
    trackerMetadata: { executedAtProvenance: "tracker-placed-at" },
  };
  assert.equal(shouldRepairSyntheticTrackerClock(alreadyAuth, { ...next, date: "2026-10-10" }), false);

  const missing = resolveTrackerExecutedAt({ date: "2026-10-10", placedAtRaw: "" });
  assert.equal(shouldRepairSyntheticTrackerClock(prior, { ...missing, date: "2026-10-10" }), false);

  // Financial execution fields are outside the receipt-clock conflict helper.
  const packed = {
    selectedSide: "HOME",
    executionLine: -3.5,
    executionPrice: -110,
    riskAmount: 2,
    executedAt: next.executedAt,
  };
  assert.deepEqual(trackerImmutableConflictFields(prior, packed), []);
});

test("trackerTicket stamps authentic Placed At onto executedAt with provenance metadata", () => {
  const row = {
    Date: "2026-10-10",
    Book: "Heritage",
    Sport: "cfb",
    Matchup: "Hawaii @ Arizona State",
    Selection: "Arizona State",
    "Bet Type": "Moneyline",
    "Entry Line": "",
    Odds: "-120",
    Risk: "2",
    "To Win": "1.67",
    Result: "OPEN",
    "P/L": "",
    "Placed At": "2026-10-10T17:42:00.000Z",
    "Heritage Ticket ID": "G10999999",
  };
  const t = trackerTicket(row, 12);
  assert.equal(t.executedAt, "2026-10-10T17:42:00.000Z");
  assert.equal(t.trackerMetadata.executedAtProvenance, "tracker-placed-at");
  assert.equal(t.trackerMetadata.prospectiveProofEligible, true);
  assert.equal(t.trackerMetadata.placedAtIso, "2026-10-10T17:42:00.000Z");
  assert.equal(t.clvStatus, "unavailable");
  assert.equal(t.trackerMetadata.calibrationEligibility, "INELIGIBLE - TRACKER SYNC UNVERIFIED");

  const syn = trackerTicket({ ...row, "Placed At": "" }, 13);
  assert.equal(syn.executedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(syn.trackerMetadata.executedAtProvenance, "synthetic-date-noon");
  assert.equal(syn.trackerMetadata.prospectiveProofEligible, false);
  assert.match(syn.trackerMetadata.calibrationEligibility, /SYNTHETIC_RECEIPT_CLOCK/);

  // Timezone-less sheet stamp is Chicago, not UTC.
  const wall = trackerTicket({ ...row, "Placed At": "2026-10-10T14:30:00" }, 14);
  assert.equal(wall.executedAt, "2026-10-10T19:30:00.000Z");
});

test("bets sync derives clock at API boundary; never trusts caller provenance upgrade", async () => {
  const bets = await readFile(new URL("../functions/api/bets.js", import.meta.url), "utf8");
  const orch = await readFile(
    new URL("../services/sports-projection-orchestrator/orchestrator.mjs", import.meta.url),
    "utf8"
  );
  assert.match(bets, /applyValidatedTrackerReceiptClock/);
  assert.match(bets, /shouldRepairSyntheticTrackerClock/);
  assert.match(bets, /trackerReplayRepairedSyntheticExecutedAt/);
  assert.match(bets, /Caller-supplied provenance|never upgrade/i);
  assert.doesNotMatch(
    bets,
    /executedAtProvenance:\s*\n?\s*packed\.trackerMetadata\?\.executedAtProvenance\s*\|\|/
  );
  assert.match(orch, /resolveTrackerExecutedAt/);
  assert.match(orch, /executedAtProvenance/);
  assert.doesNotMatch(bets, /canAuthorizeWager\s*=\s*true/);
  const pkg = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(pkg, /test\/tracker-receipt-clock\.test\.js/);
});
