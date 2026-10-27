import test from "node:test";
import assert from "node:assert/strict";
import { onRequest, tennisLegacyCutoverApiGate } from "../functions/api/_middleware.js";

const request = (path, method = "GET") =>
  new Request("https://fbis-myz.pages.dev" + path, { method });

test("Tennis API remains available while PRIMARY is authoritative", async () => {
  for (const mode of ["shadow", "primary", undefined]) {
    const env = { DB: {}, SPORT_DB_MODE_TENNIS: mode };
    assert.equal(tennisLegacyCutoverApiGate(request("/api/tennis-player-profile"), env), null);
    const actual = await onRequest({ env, request: request("/api/tennis-v2-snapshot"),
      next: async () => new Response("primary-is-authoritative", { status: 200 }) });
    assert.equal(actual.status, 200);
    assert.equal(await actual.text(), "primary-is-authoritative");
  }
});

test("activated Tennis cannot silently serve any legacy Tennis API from PRIMARY", async () => {
  for (const path of ["/api/tennis-players", "/api/tennis-official-outcome-reconcile",
    "/api/tennis-v2-snapshot", "/api/tennis-free-shadow-grade",
    "/api/tennis-private-portrait-phase3"]) {
    for (const method of ["GET", "POST"]) {
      let nextCalls = 0;
      const response = await onRequest({ env: { DB: {}, SPORT_DB_MODE_TENNIS: "sport" },
        request: request(path, method),
        next: async () => { nextCalls++; return new Response("stale"); } });
      assert.equal(response.status, 503, path);
      const body = await response.json();
      assert.equal(body.reason, "TENNIS_LEGACY_API_OWNER_NOT_MIGRATED");
      assert.equal(body.stalePrimaryFallback, false);
      assert.equal(body.canAuthorizeWager, false);
      assert.equal(nextCalls, 0);
    }
  }
});

test("Tennis fail-closed guard does not block topology audit or unrelated sports", async () => {
  const env = { SPORT_DB_MODE_TENNIS: "sport" };
  for (const path of ["/api/database-topology", "/api/health", "/api/nfl-model"]) {
    assert.equal(tennisLegacyCutoverApiGate(request(path), env), null, path);
  }
  assert.equal(tennisLegacyCutoverApiGate(request("/api/tennis-players"),
    { SPORT_DB_MODE_TENNIS: "shadow" }), null);
});
