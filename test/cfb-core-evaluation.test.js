import test from "node:test";
import assert from "node:assert/strict";
import {evaluateCfbCoreResearch} from "../functions/lib/cfbCoreEvaluation.js";
import {evaluateCfbCorePromotion,CFB_CORE_PROMOTION_GATE_V1} from "../functions/lib/cfbCorePromotion.js";
import {buildCfbCoreShadowRecord,freezeCfbCoreShadowRecords,settleCfbCoreShadowRecords} from "../functions/lib/cfbCoreShadowLedger.js";
import {CFB_CORE_SHADOW_ID} from "../functions/lib/cfbCoreChallenger.js";

function row(season, i, {market = false} = {}) {
  const kickoff = `${season}-10-17T19:30:00Z`;
  const asOf = `${season}-10-12T12:00:00Z`;
  const h = 7 + (i % 13), a = 5 + ((i * 7) % 17);
  const hd = -2 - ((i * 3) % 11), ad = -1 - ((i * 5) % 9);
  const margin = 3 + 0.6 * ((h - ad) - (a - hd));
  const total = 50 + 0.45 * ((h - ad) + (a - hd));
  const actualHome = (total + margin) / 2;
  const actualAway = (total - margin) / 2;
  return {
    gameId: `${season}-game-${i}`, season, week: 7, kickoff,
    finalAt: `${season}-10-18T19:30:00Z`, finalVerified: true,
    baselineHome: 27, baselineAway: 24,
    homeConference: i % 2 ? "SEC" : "Big Ten",
    home: {
      coreYear: season, coreThroughWeek: 6, coreOffense: h, coreDefense: hd,
      coreWeekBounded: true, coreThroughSeasonType: "regular",
      coreSourceEndpoint: "/ratings/core", coreSourceAsOf: asOf,
    },
    away: {
      coreYear: season, coreThroughWeek: 6, coreOffense: a, coreDefense: ad,
      coreWeekBounded: true, coreThroughSeasonType: "regular",
      coreSourceEndpoint: "/ratings/core", coreSourceAsOf: asOf,
    },
    actualHome, actualAway,
    ...(market ? {
      marketSpread: -3.5,
      marketTotal: 51.5,
      marketCapturedAt: `${season}-10-16T12:00:00Z`,
      spreadPriceHome: -110,
      spreadPriceAway: -105,
      closingSpread: -4,
      marketMlHome: -150,
      marketMlAway: 130,
    } : {}),
  };
}

test("three-model walk-forward reports champion vs CORE vs combined + ablation", () => {
  const rows = [2022, 2023, 2024].flatMap(y => Array.from({length: 70}, (_, i) => row(y, i, {market: true})));
  const report = evaluateCfbCoreResearch(rows, {minTrain: 50, minTest: 50, minFolds: 2});
  assert.equal(report.eligibleRows, 210);
  assert.equal(report.folds.length, 2);
  assert.ok(report.comparison.champion.spreadMae != null);
  assert.ok(report.comparison.coreOnly.spreadMae != null);
  assert.ok(report.comparison.combined.spreadMae != null);
  assert.ok(report.ablation.n > 0);
  assert.equal(report.canAuthorizeWager, false);
  assert.equal(report.playerPropsExcluded, true);
  assert.ok(report.folds.every(f => f.market.edgeThresholdSelectedOnTrain >= 1));
  assert.ok(["Demonstrated added value", "Promising but insufficient evidence",
    "No measurable improvement", "Worse than the incumbent",
    "Unable to evaluate due to data limitations"].includes(report.classification));
});

test("single-season live-like sample cannot claim demonstrated edge", () => {
  const rows = Array.from({length: 80}, (_, i) => row(2026, i));
  const report = evaluateCfbCoreResearch(rows);
  assert.equal(report.verifiedOos, false);
  assert.equal(report.classification, "Unable to evaluate due to data limitations");
  assert.ok(report.dataLimitations.includes("INSUFFICIENT_MULTI_SEASON_COVERAGE") ||
    report.dataLimitations.includes("INSUFFICIENT_OOS_FOLDS"));
});

test("promotion gate never auto-promotes and requires operator + multi-season evidence", () => {
  assert.equal(CFB_CORE_PROMOTION_GATE_V1.autoPromote, false);
  const blocked = evaluateCfbCorePromotion({
    oosN: 50, seasons: 1, folds: 1, marginMaeImprovement: 0.5, totalMaeImprovement: 0.5,
    biasAbs: 0.2, brierDegradation: 0, coverage: 1, marketRelativeImproved: true,
    netEvPositive: true, prospectiveConsistent: true, integrityOk: true,
    pitHistoricalCore: true, artifactOk: true, operatorApproved: false,
  });
  assert.equal(blocked.promote, false);
  assert.equal(blocked.promotionEligiblePendingOperator, false);
  assert.ok(blocked.fail.includes("operator-approval-required"));
  assert.equal(blocked.canAuthorizeWager, false);
});

test("shadow record flags missing CORE rather than inventing projections", () => {
  const missing = buildCfbCoreShadowRecord({
    gameId: "g1", season: 2026, week: 7, kickoff: "2026-10-18T19:30:00Z",
    championHome: 31, championAway: 24,
    home: {coreYear: 2026, coreThroughWeek: null},
    away: {coreYear: 2026, coreThroughWeek: 6, coreOffense: 1, coreDefense: -1,
      coreWeekBounded: true, coreSourceEndpoint: "/ratings/core",
      coreSourceAsOf: "2026-10-12T00:00:00Z"},
  });
  assert.equal(missing.eligibility, "ineligible");
  assert.equal(missing.coreSpread, null);
  assert.equal(missing.provenance.authority, "research_only");
  assert.ok(missing.missingReason);
});

test("freeze is insert-or-ignore immutable; settlement updates scores only", async () => {
  const writes = [];
  const env = {
    TIER3_DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                writes.push({sql, args});
                return {meta: {changes: sql.includes("INSERT") ? 1 : 1}};
              },
            };
          },
        };
      },
      async batch(stmts) {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        return out;
      },
    },
  };
  const rec = buildCfbCoreShadowRecord({
    gameId: "g2", season: 2026, week: 8, kickoff: "2026-10-25T19:30:00Z",
    championHome: 28, championAway: 21, homeTeam: "A", awayTeam: "B",
    home: {
      coreYear: 2026, coreThroughWeek: 7, coreOffense: 8, coreDefense: -3,
      coreWeekBounded: true, coreSourceEndpoint: "/ratings/core",
      coreSourceAsOf: "2026-10-20T00:00:00Z", coreThroughSeasonType: "regular",
    },
    away: {
      coreYear: 2026, coreThroughWeek: 7, coreOffense: 4, coreDefense: -1,
      coreWeekBounded: true, coreSourceEndpoint: "/ratings/core",
      coreSourceAsOf: "2026-10-20T00:00:00Z", coreThroughSeasonType: "regular",
    },
  }, {now: "2026-10-21T12:00:00Z"});
  assert.equal(rec.coreModelId, CFB_CORE_SHADOW_ID);
  // Without verified artifact, vector may be ok but projection flagged.
  assert.ok(["eligible_projected", "vector_ok_artifact_unverified", "ineligible"].includes(rec.eligibility));
  const freeze = await freezeCfbCoreShadowRecords(env, [rec]);
  assert.equal(freeze.ok, true);
  assert.ok(writes.some(w => String(w.sql).includes("INSERT OR IGNORE")));
  const settle = await settleCfbCoreShadowRecords(env, [{
    gameId: "g2", actualHome: 30, actualAway: 17, finalVerified: true,
  }]);
  assert.equal(settle.ok, true);
  assert.ok(writes.some(w => String(w.sql).includes("UPDATE") && String(w.sql).includes("actual_home")));
});


test("CORE market ROI never substitutes -110 for missing recorded prices", () => {
  const rows = [2022, 2023, 2024].flatMap(y => Array.from({length: 70}, (_, i) => {
    const r = row(y, i, {market: true});
    delete r.spreadPriceHome;
    delete r.spreadPriceAway;
    return r;
  }));
  const report = evaluateCfbCoreResearch(rows, {minTrain: 50, minTest: 50, minFolds: 2});
  assert.equal(report.folds.length, 2);
  for (const fold of report.folds) {
    for (const model of ["champion", "coreOnly", "combined"]) {
      assert.equal(fold.market[model].ats.pricedN, 0);
      assert.equal(fold.market[model].ats.unitRoi, null);
      assert.equal(fold.market[model].totals.pricedN, 0);
      assert.equal(fold.market[model].totals.unitRoi, null);
    }
  }
});
