import test from "node:test";
import assert from "node:assert/strict";
import { buildHealth } from "../functions/api/health.js";

function dbStub() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("SELECT 1")) return { ok: 1 };
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

test("health is lightweight, reports D1, and exposes the deployment SHA", async () => {
  const body = await buildHealth(
    { DB: dbStub(), CF_PAGES_COMMIT_SHA: "abc123" },
    new Date("2026-08-31T12:00:00.000Z")
  );
  assert.equal(body.ok, true);
  assert.equal(body.d1.ok, true);
  assert.equal(body.deployment_commit, "abc123");
  assert.equal(body.checked_at, "2026-08-31T12:00:00.000Z");
});

test("health fails closed when D1 is not bound", async () => {
  const body = await buildHealth({}, new Date("2026-08-31T12:00:00.000Z"));
  assert.equal(body.ok, false);
  assert.equal(body.d1.bound, false);
  assert.equal(body.d1.reason, "unbound");
});
