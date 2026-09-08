import test from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, insertPublishedProjection } from "../functions/lib/publishedProjectionStore.js";

function dbMock(existing = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const stmt = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { calls.push({ type: "first", sql, values: this.values }); return existing; },
        async run() { calls.push({ type: "run", sql, values: this.values }); return { meta: { last_row_id: 7 } }; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
}

test("published projection payload hash is deterministic", async () => {
  const a = await sha256Hex('{"x":1}');
  const b = await sha256Hex('{"x":1}');
  const c = await sha256Hex('{"x":2}');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("identical publication is idempotent", async () => {
  const db = dbMock({ id: 1, payload_hash: "abc", payload_json: "{}", published_at: "2026-09-08T00:00:00Z" });
  const out = await insertPublishedProjection({ DB: db }, {
    sport: "mlb", gameId: "1", modelVersion: "v1", payloadHash: "abc", payloadJson: "{}", gameDate: "2026-09-08", publishedAt: "2026-09-08T00:00:00Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.inserted, false);
  assert.equal(db.calls.some((c) => c.type === "run"), false);
});

test("changed payload cannot overwrite a published projection", async () => {
  const db = dbMock({ id: 1, payload_hash: "original", payload_json: "{}", published_at: "2026-09-08T00:00:00Z" });
  const out = await insertPublishedProjection({ DB: db }, {
    sport: "cfb", gameId: "2", modelVersion: "v1", payloadHash: "changed", payloadJson: '{"changed":true}', gameDate: "2026-09-08", publishedAt: "2026-09-08T00:00:00Z",
  });
  assert.equal(out.ok, false);
  assert.equal(out.conflict, true);
  assert.equal(out.reason, "immutable-published-projection-conflict");
  assert.equal(db.calls.some((c) => c.type === "run"), false);
});
