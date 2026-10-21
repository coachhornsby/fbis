import test from "node:test";
import assert from "node:assert/strict";
import { listPublishedProjections, insertPublishedProjection } from "../functions/lib/publishedProjectionStore.js";

function makeDb(name) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ name, sql, args });
          return this;
        },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() { return { meta: { last_row_id: 1 } }; },
      };
    },
  };
}

test("NFL published projections remain on PRIMARY when shadow, including writes", async () => {
  const primary = makeDb("primary"), nfl = makeDb("nfl");
  const env = { DB: primary, NFL_DB: nfl, SPORT_DB_MODE_NFL: "shadow" };
  await listPublishedProjections(env, { sport: "nfl" });
  await insertPublishedProjection(env, {
    sport: "nfl", gameId: "g1", gameDate: "2026-10-21", modelVersion: "m",
    payloadHash: "h", payloadJson: "{}", publishedAt: "2026-10-21T12:00:00Z",
  });
  assert.ok(primary.calls.length >= 3);
  assert.equal(nfl.calls.length, 0);
});
test("Unapproved sport mode cannot redirect NFL published projections", async () => {
  const primary = makeDb("primary"), nfl = makeDb("nfl");
  const env = { DB: primary, NFL_DB: nfl, SPORT_DB_MODE_NFL: "sport", SPORT_CUTOVER_RECEIPT_NFL: "unapproved" };
  await listPublishedProjections(env, { sport: "nfl" });
  assert.ok(primary.calls.length);
  assert.equal(nfl.calls.length, 0);
});
test("NFL approved router switch is sport-scoped; all-sport reads stay PRIMARY", async () => {
  const primary = makeDb("primary"), nfl = makeDb("nfl");
  const receipt = "fixture-receipt";
  const env = {
    DB: primary, NFL_DB: nfl, SPORT_DB_MODE_NFL: "sport",
    SPORT_CUTOVER_RECEIPT_NFL: receipt,
    __fbisCutoverApprovals: new Map([[`nfl:${receipt}`, {
      sport: "nfl", receipt_id: receipt, status: "APPROVED",
      approved_at: new Date().toISOString(),
    }]]),
  };
  await listPublishedProjections(env, { sport: "nfl" });
  await listPublishedProjections(env);
  await listPublishedProjections(env, { sport: "cfb" });
  assert.equal(nfl.calls.length, 1);
  assert.equal(primary.calls.length, 2);
});
