import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateCfbWeekFromDate,
  coreThroughWeekBound,
  enrichCatalogWithCoreProvenance,
  indexAdvancedGameRows,
  indexPpaGameRows,
  indexPlayerSeasonRoles,
  CFB_CORE_ADVANCED_AUTHORITY,
} from "../functions/lib/cfbCoreAdvancedPlumbing.js";
import { indexCfbRatings } from "../functions/lib/collegeJobsCore.js";
import { acknowledgeCfbdQuotaReplenishment } from "../functions/lib/cfbCfbdAcquisition.js";

test("week helpers stay fail-closed", () => {
  assert.equal(coreThroughWeekBound(7), 6);
  assert.equal(coreThroughWeekBound(1), 0);
  assert.equal(coreThroughWeekBound(null), null);
  const w = estimateCfbWeekFromDate(new Date("2026-10-15T12:00:00Z"), 2026);
  assert.ok(w >= 6 && w <= 10);
});

test("indexCfbRatings persists CORE provenance and advanced team fields", () => {
  const catalog = indexCfbRatings({
    "/ratings/core": [{
      team: "Ohio State", conference: "Big Ten", rating: 22.1,
      offense: { rating: 18 }, defense: { rating: -4 },
      throughWeek: 6, throughSeasonType: "regular",
    }],
    "/ppa/teams": [{ team: "Ohio State", offense: { overall: 0.3, passing: 0.2, rushing: 0.1 },
      defense: { overall: -0.1, passing: -0.05, rushing: -0.02 } }],
    "/stats/season/advanced": [{
      team: "Ohio State",
      offense: { successRate: 0.48, explosiveness: 1.2, lineYards: 2.9, havoc: { total: 0.12 }, pointsPerOpportunity: 4.1 },
      defense: { successRate: 0.35, explosiveness: 1.0, lineYards: 2.4, havoc: { total: 0.18 }, pointsPerOpportunity: 3.2 },
    }],
  });
  const row = Object.values(catalog.byCanonicalId)[0];
  assert.ok(row);
  assert.equal(row.core, 22.1);
  assert.equal(row.coreThroughWeek, 6);
  assert.equal(row.coreOffense, 18);
  assert.equal(row.ppaPass, 0.2);
  assert.equal(row.offensivePointsPerOpportunity, 4.1);
});

test("enrichCatalog scrubs future throughWeek and keeps research-only flag", () => {
  const base = indexCfbRatings({
    "/ratings/core": [{
      team: "Ohio State", rating: 22, throughWeek: 9, throughSeasonType: "regular",
      offense: 10, defense: -2,
    }],
  });
  const enriched = enrichCatalogWithCoreProvenance(base, [
    { team: "Ohio State", rating: 20, throughWeek: 5, throughSeasonType: "regular", offense: 9, defense: -1 },
  ], { maxWeek: 5, seasonType: "regular" });
  const row = Object.values(enriched.byCanonicalId)[0];
  assert.equal(row.coreThroughWeek, 5);
  assert.equal(row.coreWeekBounded, true);
  assert.equal(enriched.authority, CFB_CORE_ADVANCED_AUTHORITY);
  assert.equal(enriched.canAuthorizeWager, false);

  const scrubbed = enrichCatalogWithCoreProvenance(base, [], { maxWeek: 5, seasonType: "regular" });
  const scrubRow = Object.values(scrubbed.byCanonicalId)[0];
  assert.equal(scrubRow.coreThroughWeek, null);
  assert.equal(scrubRow.coreWeekBounded, false);
});

test("game and player indexes map under fail-closed identity", () => {
  const adv = indexAdvancedGameRows([{
    gameId: "401", team: "Ohio State", week: 6, season: 2026, homeAway: "home",
    offense: { successRate: 0.5, explosiveness: 1.1, lineYards: 3, havoc: { total: 0.1 }, pointsPerOpportunity: 4 },
    defense: { successRate: 0.3, explosiveness: 0.9, lineYards: 2.2, havoc: { total: 0.2 }, pointsPerOpportunity: 2.5 },
  }]);
  assert.equal(adv.n, 1);
  const ppa = indexPpaGameRows([{
    gameId: "401", team: "Ohio State", week: 6,
    offense: { overall: 0.25, passing: 0.2, rushing: 0.1 },
    defense: { overall: -0.1 },
  }]);
  assert.equal(ppa.n, 1);
  const players = indexPlayerSeasonRoles({
    qbRows: [{ player: "QB One", team: "Ohio State", averagePPA: { all: 0.4, pass: 0.5 }, countedPlays: 100 }],
    usageRows: [{ player: "QB One", team: "Ohio State", usage: { overall: 0.3, pass: 0.4 } }],
  });
  assert.equal(players.n, 1);
  assert.equal(players.canAuthorizeWager, false);
});

test("quota replenishment ack requires operator approval", async () => {
  const writes = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async run() {
                writes.push({ sql, params });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
  const denied = await acknowledgeCfbdQuotaReplenishment(env, { remaining: 75000, operatorApproved: false });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "OPERATOR_APPROVAL_REQUIRED");
  const ok = await acknowledgeCfbdQuotaReplenishment(env, { remaining: 75000, operatorApproved: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.providerRemaining, 75000);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /last_remaining/);
});

test("undated and post-cutoff CORE never survives in canonical or ESPN catalog",()=>{
  const base=indexCfbRatings({
    "/ratings/core":[{team:"Ohio State",rating:24,offense:16,defense:-8,
      throughWeek:9,throughSeasonType:"regular"}],
    "/ppa/teams":[{team:"Ohio State",offense:{overall:.2}}],
  });
  const contaminated = Object.values(base.byCanonicalId)[0];
  const id=contaminated.canonicalId;
  assert.ok(base.byEspnId);
  const empty=enrichCatalogWithCoreProvenance(base,[
    {team:"Ohio State",rating:100,offense:75,defense:-25,
      throughWeek:9,throughSeasonType:"regular"},
    {team:"Ohio State",rating:40,offense:30,defense:-10,
      throughSeasonType:"regular"},
  ],{maxWeek:6,seasonType:"regular"});
  const row=empty.byCanonicalId[id];
  assert.equal(row.core,null);
  assert.equal(row.coreOffense,null);
  assert.equal(row.coreDefense,null);
  assert.equal(row.coreWeekBounded,false);
  assert.equal(row.coreTemporalNote,"no-eligible-week-bounded-core");
  assert.equal(row.ppaOff,.2);
  assert.ok(empty.coreScrubbed>=1);
  for(const indexed of Object.values(empty.byEspnId))
    assert.equal(indexed.core,null);
  const valid=enrichCatalogWithCoreProvenance(base,[{
    team:"Ohio State",rating:19,offense:13,defense:-6,
    throughWeek:6,throughSeasonType:"regular",
  }],{maxWeek:6,seasonType:"regular"});
  assert.equal(valid.byCanonicalId[id].core,19);
  assert.equal(valid.byCanonicalId[id].coreThroughWeek,6);
  for(const indexed of Object.values(valid.byEspnId))
    assert.equal(indexed.core,19);
});

test("undated CORE is not interpreted as completed week zero",async()=>{
  const {normalizeCoreRating,indexCoreByTeam}=await import("../functions/lib/cfbdCanonical.js");
  assert.equal(normalizeCoreRating({team:"Ohio State",rating:8}).throughWeek,null);
  assert.equal(Object.keys(indexCoreByTeam([{team:"Ohio State",rating:8}],{maxWeek:6})).length,0);
});
