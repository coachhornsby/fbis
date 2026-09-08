import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productProjectionBoard, FORBIDDEN_PRODUCT_KEYS } from "../functions/lib/productProjection.js";
import { authorizeProductTier, productResponsePolicy } from "../functions/lib/productAccess.js";

test("public projection board exposes product data but not private operator payloads", () => {
  const slate = {
    sport: "cfb", date: "2026-09-08", modelVersion: "FBIS-v1.4",
    games: [{
      id: "g1", start: "2026-09-08T23:00:00Z", projectionKind: "FBIS",
      home: { name: "Home", canonicalId: "h" }, away: { name: "Away", canonicalId: "a" },
      model: { projectionKind: "FBIS", projHome: 31, projAway: 21, projMargin: 10, projTotal: 52, pHomeFinal: 0.72 },
      odds: { pinHomeMl: -250, pinAwayMl: 210, spread: -7, total: 49 },
      pin: { ml: { complete: true, priceA: -250, priceB: 210, noVigA: 0.69, noVigB: 0.31 } },
      quality: { score: 0.9, flags: [] },
      executedBets: [{ secret: true }], strategyTickets: [{ secret: true }], playerProps: [{ secret: true }],
    }],
  };
  const out = productProjectionBoard(slate, { tier: "public" });
  const dump = JSON.stringify(out);
  assert.equal(out.games[0].projection.independent, true);
  assert.equal(out.games[0].projection.home, 31);
  assert.equal(out.games[0].decision.pick, null);
  for (const key of FORBIDDEN_PRODUCT_KEYS) assert.equal(dump.includes(`\"${key}\"`), false, key);
});

test("market-implied CBB/NFL never masquerades as product projection", () => {
  for (const sport of ["cbb", "nfl"]) {
    const out = productProjectionBoard({ sport, games: [{ id: "x", projectionKind: "PINNACLE_IMPLIED", home: { name: "H" }, away: { name: "A" }, model: { projectionKind: "PINNACLE_IMPLIED", projHome: 75, projAway: 70 } }] });
    assert.equal(out.games[0].projection.independent, false);
    assert.equal(out.games[0].projection.home, null);
    assert.equal(out.games[0].decision.status, "PASS");
  }
});

test("PRO access fails closed until a subscriber credential is configured", () => {
  const publicAccess = authorizeProductTier(new Request("https://x.test"), {}, "public");
  assert.equal(publicAccess.ok, true);
  const locked = authorizeProductTier(new Request("https://x.test"), {}, "pro");
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "pro-access-unconfigured");
  const denied = authorizeProductTier(new Request("https://x.test", { headers: { "x-fbis-pro-token": "wrong" } }), { SUBSCRIBER_API_TOKEN: "right" }, "pro");
  assert.equal(denied.ok, false);
  const allowed = authorizeProductTier(new Request("https://x.test", { headers: { "x-fbis-pro-token": "right" } }), { SUBSCRIBER_API_TOKEN: "right" }, "pro");
  assert.equal(allowed.ok, true);
});

test("PRO responses are never shared-cacheable while PUBLIC can use stale-while-revalidate", () => {
  const pro = productResponsePolicy("pro");
  assert.match(pro.cacheControl, /private/);
  assert.match(pro.cacheControl, /no-store/);
  assert.equal(pro.allowOrigin, null);
  const pub = productResponsePolicy("public");
  assert.match(pub.cacheControl, /public/);
  assert.match(pub.cacheControl, /stale-while-revalidate/);
  assert.equal(pub.allowOrigin, "*");
});

test("projection serving is paid-feed cache-only", async () => {
  const source = await readFile(new URL("../functions/api/projections.js", import.meta.url), "utf8");
  assert.match(source, /parlayCacheOnly:\s*true/);
  assert.match(source, /palCacheOnly:\s*true/);
  assert.doesNotMatch(source, /parlayCacheOnly:\s*false/);
  assert.doesNotMatch(source, /palCacheOnly:\s*false/);
});
