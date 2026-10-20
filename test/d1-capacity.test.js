import test from "node:test";
import assert from "node:assert/strict";
import { isD1CapacityError } from "../functions/lib/d1Capacity.js";
import { consumePinnoddsSnapshot, reconcilePinnoddsSnapshot } from "../functions/lib/pinnoddsIngestion.js";

test("detects Cloudflare D1 maximum size errors", () => {
  assert.equal(isD1CapacityError(new Error("D1_ERROR: Exceeded maximum DB size")), true);
  assert.equal(isD1CapacityError(new Error("SQLITE_FULL")), true);
  assert.equal(isD1CapacityError(new Error("network timeout")), false);
});

test("PinnOdds consume soft-fails on market-history capacity and keeps research-only authority", async () => {
  const snapshotId = "capacity-board-3-prematch";
  const at = "2026-10-20T00:29:25.071Z";
  const receipt = {
    ok: true, snapshotId, sportId: 3, feed: "prematch", kind: "board", collectedAt: at, rawKey: "raw",
    projectionScope: "FBIS_MODELED_EVENTS_ONLY", normalizedRows: 2, matchedRows: 2, batches: 1, batchSize: 100,
    rows: [
      { eventId: "401909088", sport: "nba", marketFamily: "moneyline", side: "home", decimalOdds: 2 },
      { eventId: "401909088", sport: "nba", marketFamily: "moneyline", side: "away", decimalOdds: 1.9 },
    ],
  };
  const values = new Map([
    [`market-sources/pinnodds/normalized/${snapshotId}.json`, JSON.stringify(receipt)],
    ["market-sources/pinnodds/latest-modeled/board-3-prematch.json", JSON.stringify({
      schemaVersion: 1, source: "PinnOdds", sportId: 3, feed: "prematch", snapshotId, collectedAt: at,
      rows: receipt.rows, readOnly: true, canAuthorizeWager: false,
    })],
  ]);
  const env = {
    ARCHIVE: {
      async get(key) { return values.has(key) ? { async json() { return JSON.parse(values.get(key)); } } : null; },
      async put(key, value) { values.set(key, typeof value === "string" ? value : JSON.stringify(value)); },
    },
    MARKET_HISTORY_DB: {
      prepare() {
        return {
          bind() {
            return {
              async run() { throw new Error("D1_ERROR: Exceeded maximum DB size"); },
              async first() { throw new Error("D1_ERROR: Exceeded maximum DB size"); },
              async all() { throw new Error("D1_ERROR: Exceeded maximum DB size"); },
            };
          },
        };
      },
      batch() { throw new Error("D1_ERROR: Exceeded maximum DB size"); },
    },
    DB: { prepare() { return { bind() { return { async all() { return { results: [] }; } }; } }; } },
  };
  const consumed = await consumePinnoddsSnapshot(env, { snapshotId, batchIndex: 0 });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.d1CapacityDegraded, true);
  assert.equal(consumed.inserted, 0);
  assert.equal(consumed.canAuthorizeWager, false);
  const reconciled = await reconcilePinnoddsSnapshot(env, { snapshotId });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.d1Reconciled, false);
  assert.equal(reconciled.d1CapacityDegraded, true);
  assert.equal(reconciled.canAuthorizeWager, false);
  const latest = JSON.parse(values.get("market-sources/pinnodds/latest/board-3-prematch.json"));
  assert.equal(latest.snapshotId, snapshotId);
  assert.equal(latest.canAuthorizeWager, false);
});
