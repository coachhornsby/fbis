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
  assert.equal(out.games[0].model.name, "FBIS CFB");
  assert.match(out.games[0].model.engine, /Opponent Residual/);
  assert.equal(out.games[0].decision.pick, null);
  for (const key of FORBIDDEN_PRODUCT_KEYS) assert.equal(dump.includes(`\"${key}\"`), false, key);
});

test("CFB LLM digest exposes paid CFBD signals but no market/projection fields", () => {
  const out = productProjectionBoard({
    sport: "cfb",
    games: [{
      id:"cfb-rich-1", sport:"cfb", projectionKind:"FBIS",
      home:{ name:"Ohio State", school:"Ohio State", espnId:"194" },
      away:{ name:"Michigan", school:"Michigan", espnId:"130" },
      model:{ projectionKind:"FBIS", projHome:31, projAway:24, projMargin:7, projTotal:55 },
      cfb:{
        projectionState:"COMPLETE", dataQuality:84,
        homeEst:{ priorOff:38, priorDef:17, currentOff:33, currentDef:20, n:3, teamSpecificPrior:true, featureVector:{ raw:{ epaNet:0.31, transferNet:2, returningPct:61, talent:960, coachTenure:6, qbPriorPpa:0.28, qbPriorYpa:8.4, qbPriorGamesStarted:12 }, components:{ epa:0.62, transfer:0.2, qb:0.4, coaching:0.6, returning:0.3, talent:0.8 }, source:{ epa:"cfbd" }, missing:[] } },
        awayEst:{ priorOff:31, priorDef:20, currentOff:27, currentDef:22, n:3, teamSpecificPrior:true, featureVector:{ raw:{ epaNet:0.12, transferNet:-1, returningPct:54, talent:910, coachTenure:2 }, components:{ epa:0.24, transfer:-0.1, coaching:0.1, returning:-0.05, talent:0.3 }, source:{ epa:"cfbd" }, missing:["qb_missing"] } },
      },
      cfbDeepInput:{
        home:{ gamesPlayed:3, currentPointsForPerGame:33, currentPointsAgainstPerGame:20, offensePpa:0.30, defensePpa:-0.10, passEpa:0.34, rushEpa:0.21, passEpaAllowed:-0.12, rushEpaAllowed:-0.08, successRate:0.49, successRateAllowed:0.34, explosiveRate:1.25, explosiveRateAllowed:0.82, havocRate:0.19, havocAllowed:0.11, lineYards:3.4, lineYardsAllowed:2.4, stuffRate:0.22, pointsPerOpportunity:4.8, pointsPerOpportunityAllowed:2.9, pacePlays:72 },
        away:{ gamesPlayed:3, currentPointsForPerGame:27, currentPointsAgainstPerGame:22, offensePpa:0.14, defensePpa:-0.05, passEpa:0.12, rushEpa:0.18, passEpaAllowed:-0.06, rushEpaAllowed:-0.03, successRate:0.42, successRateAllowed:0.39, explosiveRate:1.02, explosiveRateAllowed:0.94, havocRate:0.15, havocAllowed:0.13, lineYards:3.0, lineYardsAllowed:2.8, stuffRate:0.18, pointsPerOpportunity:3.7, pointsPerOpportunityAllowed:3.4, pacePlays:66 },
      },
      odds:{ spread:-7.5, total:55.5, pinHomeMl:-300, pinAwayMl:240 },
      quality:{ score:84, flags:[] },
    }],
  });
  const features=out.games[0].llmFeatures;
  assert.equal(features.version,"llm-features-v2-cfbd");
  assert.equal(features.independentInputsOnly,true);
  assert.ok(features.featureCount >= 20);
  assert.equal(features.home.passEpa,0.34);
  assert.equal(features.home.havocRate,0.19);
  assert.equal(features.home.currentPointsForPerGame,33);
  const dump=JSON.stringify(features);
  assert.doesNotMatch(dump, /"spread"|"odds"|"market"|"projectedScore"|"projHome"|"projAway"/i);
});

test("MLB exposes Ballpark Pal as a separate cross-check without overwriting FBIS", () => {
  const out = productProjectionBoard({
    sport: "mlb",
    games: [{
      id: "mlb-1", projectionKind: "FBIS",
      home: { name: "Home" }, away: { name: "Away" },
      model: { projectionKind: "FBIS", projHome: 4.8, projAway: 3.9, projMargin: 0.9, projTotal: 8.7, pHomeFinal: 0.61 },
      bpp: { homeRuns: 4.4, awayRuns: 4.0, pHome: 0.56, lineupsOfficial: true, f5: { homeRuns: 2.3, awayRuns: 2.0, total: 4.3 } },
      quality: { score: 88, flags: [] },
    }],
  });
  const card = out.games[0];
  assert.equal(card.projection.home, 4.8);
  assert.equal(card.projection.away, 3.9);
  assert.equal(card.model.name, "FBIS MLB");
  assert.equal(card.externalModels.ballparkPal.available, true);
  assert.equal(card.externalModels.ballparkPal.home, 4.4);
  assert.equal(card.externalModels.ballparkPal.role, "INDEPENDENT_CROSS_CHECK");
  assert.equal(card.externalModels.ballparkPal.comparison.agreement, "AGREE");
});

test("live games expose live score but explicitly preserve pregame projection lifecycle", () => {
  const out = productProjectionBoard({
    sport: "mlb",
    games: [{
      id: "live-1", projectionKind: "FBIS",
      home: { name: "Home", score: 3 }, away: { name: "Away", score: 2 },
      status: { live: true, completed: false, detail: "Top 6th" },
      model: { projectionKind: "FBIS", projHome: 4.8, projAway: 3.9, pHomeFinal: 0.61 },
      quality: { score: 88, flags: [] },
    }],
  });
  const card = out.games[0];
  assert.equal(card.gameState.state, "LIVE");
  assert.deepEqual(card.gameState.currentScore, { away: 2, home: 3 });
  assert.equal(card.projection.lifecycle, "PREGAME");
  assert.equal(card.projection.liveReforecast, false);
  assert.equal(card.projection.home, 4.8);
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

test("public projection page cannot request or persist PRO credentials", async () => {
  const html = await readFile(new URL("../public/projections.html", import.meta.url), "utf8");
  const client = await readFile(new URL("../public/projections.js", import.meta.url), "utf8");
  const source = `${html}\n${client}`;
  assert.match(client, /tier:\s*"public"/);
  assert.doesNotMatch(source, /x-fbis-pro-token/i);
  assert.doesNotMatch(source, /SUBSCRIBER_API_TOKEN/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
