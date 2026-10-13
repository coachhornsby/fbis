import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TRACKER_EXECUTED_AT_PROVENANCE,
  isAuthenticTrackerReceiptClock,
  isSyntheticTrackerNoon,
  parseTrackerPlacedAt,
  resolveTrackerExecutedAt,
  shouldRepairSyntheticTrackerClock,
  trackerCalibrationEligibility,
} from "../functions/lib/trackerReceiptClock.js";
import { trackerTicket } from "../services/sports-projection-orchestrator/orchestrator.mjs";

test("Placed At ISO and CT wall clocks authenticate; date-only does not", () => {
  assert.equal(parseTrackerPlacedAt("2026-10-10T19:30:00.000Z")?.iso, "2026-10-10T19:30:00.000Z");
  const wall = parseTrackerPlacedAt("2026-10-10 14:30");
  assert.ok(wall?.iso);
  assert.match(wall.iso, /^2026-10-10T/);
  assert.equal(parseTrackerPlacedAt("2026-10-10"), null);
  assert.equal(parseTrackerPlacedAt(""), null);
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

  const syn = resolveTrackerExecutedAt({ date: "2026-10-10", placedAtRaw: "" });
  assert.equal(syn.executedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(syn.provenance, TRACKER_EXECUTED_AT_PROVENANCE.SYNTHETIC_DATE_NOON);
  assert.equal(syn.prospectiveProofEligible, false);
  assert.equal(isSyntheticTrackerNoon(syn.executedAt, "2026-10-10"), true);
  assert.match(trackerCalibrationEligibility(syn.provenance), /SYNTHETIC_RECEIPT_CLOCK/);
});

test("one-way repair only replaces synthetic noon with authenticated Placed At", () => {
  const prior = {
    date: "2026-10-10",
    executedAt: "2026-10-10T12:00:00.000Z",
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

  const syn = trackerTicket({ ...row, "Placed At": "" }, 13);
  assert.equal(syn.executedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(syn.trackerMetadata.executedAtProvenance, "synthetic-date-noon");
  assert.equal(syn.trackerMetadata.prospectiveProofEligible, false);
  assert.match(syn.trackerMetadata.calibrationEligibility, /SYNTHETIC_RECEIPT_CLOCK/);
});

test("bets sync and orchestrator wire receipt-clock helpers without wager-authority changes", async () => {
  const bets = await readFile(new URL("../functions/api/bets.js", import.meta.url), "utf8");
  const orch = await readFile(
    new URL("../services/sports-projection-orchestrator/orchestrator.mjs", import.meta.url),
    "utf8"
  );
  assert.match(bets, /resolveTrackerExecutedAt/);
  assert.match(bets, /shouldRepairSyntheticTrackerClock/);
  assert.match(bets, /trackerReplayRepairedSyntheticExecutedAt/);
  assert.match(bets, /trackerCalibrationEligibility/);
  assert.match(bets, /prospectiveProofEligible/);
  assert.match(orch, /resolveTrackerExecutedAt/);
  assert.match(orch, /executedAtProvenance/);
  assert.match(orch, /synthetic-date-noon|SYNTHETIC_RECEIPT_CLOCK|trackerCalibrationEligibility/);
  assert.doesNotMatch(bets, /canAuthorizeWager\s*=\s*true/);
});
