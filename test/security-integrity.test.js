import test from "node:test";
import assert from "node:assert/strict";

import { authorizeHarvest, authorizeStrategyPost } from "../functions/lib/auth.js";
import { qualificationIntegrity, recommendBundle } from "../functions/lib/slateEngine.js";
import { MODEL_VERSION } from "../functions/lib/weights.js";
import { CHAMPION_CFB } from "../functions/lib/collegeModels.js";
import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";

function req(url = "https://fbis.example/api/collect", headers = {}) {
  return new Request(url, { headers });
}

test("harvest authorization fails closed when the secret is not configured", () => {
  const out = authorizeHarvest(req(), {});
  assert.equal(out.ok, false);
  assert.equal(out.reason, "secret-unconfigured");
});

test("harvest and strategy authorization accept only the configured secret", () => {
  const env = { HARVEST_SECRET: "abc123" };
  assert.equal(authorizeHarvest(req("https://fbis.example/api/collect", { "x-harvest-secret": "abc123" }), env).ok, true);
  assert.equal(authorizeHarvest(req("https://fbis.example/api/collect", { "x-harvest-secret": "wrong" }), env).ok, false);
  assert.equal(authorizeStrategyPost(req("https://fbis.example/api/strategy", { "x-strategy-secret": "abc123" }), env).ok, true);
});

test("CBB and NBA market-implied scores are never qualification eligible", () => {
  for (const sport of ["cbb", "nba", "nfl"]) {
    const game = { sport, projectionKind: "PINNACLE_IMPLIED", quality: { flags: ["pinnacle_implied_score"] } };
    const gate = qualificationIntegrity(sport, game);
    assert.equal(gate.ok, false);
    const bundle = recommendBundle(sport, game, { layers: { market: 0.5 } });
    assert.equal(bundle.qualified, null);
    assert.equal(bundle.blocked, true);
  }
});

test("independent FBIS CBB projection clears the independence gate", () => {
  const gate = qualificationIntegrity("cbb", { sport: "cbb", projectionKind: "FBIS", quality: { flags: [] } });
  assert.equal(gate.ok, true);
});

test("unresolved MLB probable starters block qualification", () => {
  const gate = qualificationIntegrity("mlb", { sport: "mlb", projectionKind: "FBIS", quality: { flags: ["missing_home_sp"] } });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "missing_home_sp");
});

test("track POST is protected by API middleware", async () => {
  let nextCalled = false;
  const denied = await apiMiddleware({
    request: new Request("https://fbis.example/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reconstruct-probability" }),
    }),
    env: { HARVEST_SECRET: "abc123" },
    next: async () => { nextCalled = true; return new Response("ok"); },
  });
  assert.equal(denied.status, 401);
  assert.equal(nextCalled, false);

  const allowed = await apiMiddleware({
    request: new Request("https://fbis.example/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", "x-strategy-secret": "abc123" },
      body: JSON.stringify({ action: "reconstruct-probability" }),
    }),
    env: { HARVEST_SECRET: "abc123" },
    next: async () => { nextCalled = true; return new Response(null, { status: 204 }); },
  });
  assert.equal(allowed.status, 204);
  assert.equal(nextCalled, true);
});

test("track manual-final allows same-origin board writes without a secret header", async () => {
  let nextCalled = false;
  const deniedCrossOrigin = await apiMiddleware({
    request: new Request("https://fbis.example/api/track", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ action: "manual-final", homeScore: 1, awayScore: 0 }),
    }),
    env: { HARVEST_SECRET: "abc123" },
    next: async () => { nextCalled = true; return new Response("ok"); },
  });
  assert.equal(deniedCrossOrigin.status, 401);
  assert.equal(nextCalled, false);

  const allowedSameOrigin = await apiMiddleware({
    request: new Request("https://fbis.example/api/track", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://fbis.example",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ action: "manual-final", homeScore: 1, awayScore: 0 }),
    }),
    env: { HARVEST_SECRET: "abc123" },
    next: async () => { nextCalled = true; return new Response(null, { status: 204 }); },
  });
  assert.equal(allowedSameOrigin.status, 204);
  assert.equal(nextCalled, true);
});

test("college champion label follows the canonical model version", () => {
  assert.equal(CHAMPION_CFB, MODEL_VERSION);
  assert.equal(MODEL_VERSION, "FBIS-v1.4");
});
