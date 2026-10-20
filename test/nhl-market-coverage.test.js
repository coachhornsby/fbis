import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMarketEvidence,
  acceptPointInTimeSnapshot,
  retainArchivedQuote,
  linkArchivedQuotes,
  summarizeMarketCoverage,
} from "../functions/lib/nhlMarketCoverage.js";

const start = "2026-10-21T23:00:00Z";
const pregame = "2026-10-21T18:00:00Z";

test("a complete pregame price is positive evidence and a one-sided capture is not a probability", () => {
  const positive = classifyMarketEvidence({
    looked: true, eventPresent: true, period: "full_game",
    homeDecimal: 1.8, awayDecimal: 2.1, collectedAt: pregame, eventStart: start,
  });
  assert.equal(positive.evidenceClass, "POSITIVE");
  assert.ok(positive.fairHome > 0 && positive.fairHome < 1);
  const oneSided = classifyMarketEvidence({
    looked: true, eventPresent: true, period: "full_game",
    homeDecimal: 1.8, awayDecimal: null, collectedAt: pregame, eventStart: start,
  });
  assert.equal(oneSided.evidenceClass, "NEGATIVE");
  assert.equal(oneSided.fairHome, null);
  assert.equal(oneSided.usable, false);
});

test("no capture is missing evidence, distinct from an explicit empty market", () => {
  assert.equal(classifyMarketEvidence(null).evidenceClass, "MISSING");
  assert.equal(classifyMarketEvidence({ looked: false, eventPresent: false }).reason, "NO_CAPTURE");
  const empty = classifyMarketEvidence({
    looked: true, eventPresent: true, period: "full_game",
    homeDecimal: null, awayDecimal: null, collectedAt: pregame, eventStart: start,
  });
  assert.equal(empty.evidenceClass, "NEGATIVE");
  assert.equal(empty.reason, "CAPTURED_EVENT_WITHOUT_FULL_GAME_TWO_WAY");
});

test("archived snapshots are reused and a rewritten hash is refused", () => {
  const first = { snapshotId: "snap-1", rawHash: "aaa", providerEventId: "p1", collectedAt: pregame };
  const reused = acceptPointInTimeSnapshot(first, { ...first });
  assert.equal(reused.action, "REUSE_ARCHIVED");
  assert.equal(reused.additionalRequests, 0);
  const rewritten = acceptPointInTimeSnapshot(first, { ...first, rawHash: "bbb" });
  assert.equal(rewritten.ok, false);
  assert.equal(rewritten.reason, "PIT_SNAPSHOT_IMMUTABLE");
  const later = acceptPointInTimeSnapshot(first, { snapshotId: "snap-2", rawHash: "ccc" });
  assert.equal(later.action, "RETAIN_NEW_SNAPSHOT");
  assert.equal(later.additionalRequests, 0);
});

test("linking archived quotes raises coverage without a new provider request", () => {
  const games = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}` }));
  let ledger = [];
  for (let i = 0; i < 20; i++) {
    const held = retainArchivedQuote(ledger, {
      snapshotId: `snap-${i}`,
      rawHash: `hash-${i}`,
      providerEventId: `p${i}`,
      gameId: i < 17 ? `g${i}` : null,
      looked: true,
      eventPresent: true,
      period: "full_game",
      homeDecimal: 1.91,
      awayDecimal: 1.91,
      collectedAt: pregame,
      eventStart: start,
    });
    assert.equal(held.decision.additionalRequests, 0);
    ledger = held.ledger;
  }
  const before = summarizeMarketCoverage(games, ledger);
  assert.equal(before.covered, 17);
  assert.equal(before.missing, 3);
  assert.equal(before.additionalRequests, 0);
  const linked = linkArchivedQuotes(ledger, [
    { providerEventId: "p17", gameId: "g17" },
    { providerEventId: "p18", gameId: "g18" },
    { providerEventId: "p19", gameId: "g19" },
  ]);
  assert.equal(linked[17].collectedAt, pregame);
  assert.equal(linked[17].rawHash, "hash-17");
  const after = summarizeMarketCoverage(games, linked);
  assert.equal(after.covered, 20);
  assert.equal(after.missing, 0);
  assert.equal(after.rows[0].independentSamples, 1);
  assert.equal(after.additionalRequests, 0);
});

test("two snapshots of one game remain one sample and keep the later pregame price", () => {
  const coverage = summarizeMarketCoverage([{ id: "g1" }], [
    {
      gameId: "g1", looked: true, eventPresent: true, period: "full_game",
      homeDecimal: 1.7, awayDecimal: 2.2, collectedAt: "2026-10-21T12:00:00Z", eventStart: start,
      snapshotId: "early", rawHash: "e",
    },
    {
      gameId: "g1", looked: true, eventPresent: true, period: "full_game",
      homeDecimal: 1.9, awayDecimal: 1.9, collectedAt: pregame, eventStart: start,
      snapshotId: "late", rawHash: "l",
    },
  ]);
  assert.equal(coverage.covered, 1);
  assert.equal(coverage.rows[0].snapshotCount, 2);
  assert.equal(coverage.rows[0].independentSamples, 1);
  assert.equal(coverage.rows[0].snapshotId, "late");
  assert.equal(coverage.rows[0].collectedAt, pregame);
});
