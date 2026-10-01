import test from "node:test";
import assert from "node:assert/strict";
import { curatedMarketsForSport, marketStatus, PROP_MARKET_STATUS } from "../functions/lib/propMarketPolicy.js";
import { planPrizePicksRuns, estimatePrizePicksCostUsd, normalizePrizePicksProjection, PRIZEPICKS_APIFY_ACTOR_ID } from "../functions/lib/prizePicksApify.js";
import { evaluateSharedApifySpend, querySharedApifyMonthToDateUsd } from "../functions/lib/sharedApifyBudget.js";
import { candidateOpponent, opponentOf, teamOf } from "../functions/api/prizepicks-props.js";

test("MLB acquisition is limited to Ks and pitching outs", () => {
  assert.deepEqual(curatedMarketsForSport("mlb"), ["Pitcher Strikeouts","Pitching Outs"]);
  assert.equal(marketStatus("mlb","Pitcher Strikeouts"), PROP_MARKET_STATUS.PRIMARY);
  assert.equal(marketStatus("mlb","Hits"), PROP_MARKET_STATUS.BLOCKED);
});

test("tennis acquisition centers total games; research expansion is explicit", () => {
  assert.deepEqual(curatedMarketsForSport("tennis",{includeResearch:false}), ["Total Games"]);
  assert.deepEqual(curatedMarketsForSport("tennis"), ["Total Games","Total Games Won"]);
});

test("NBA/WNBA and soccer remain research until validation", () => {
  assert.equal(marketStatus("nba","Rebounds"), PROP_MARKET_STATUS.RESEARCH);
  assert.equal(marketStatus("wnba","Assists"), PROP_MARKET_STATUS.RESEARCH);
  assert.equal(marketStatus("soccer","SOT"), PROP_MARKET_STATUS.RESEARCH);
});

test("PrizePicks planner creates narrow per-sport actor inputs", () => {
  const runs=planPrizePicksRuns({
    sports:["mlb","tennis"],
    playerNamesBySport:{mlb:["Pitcher A","Pitcher B"]},
  });
  assert.equal(runs.length,2);
  assert.equal(runs[0].actorId,PRIZEPICKS_APIFY_ACTOR_ID);
  assert.deepEqual(runs[0].input.leagues,["MLB"]);
  assert.match(runs[0].input.statTypes,/Pitcher Strikeouts/);
  assert.equal(runs[0].input.playerNames,"Pitcher A, Pitcher B");
  assert.deepEqual(runs[1].input.leagues,["Tennis"]);
});

test("PrizePicks estimator matches published PPE economics", () => {
  assert.equal(estimatePrizePicksCostUsd(1000,1),0.10);
  assert.equal(estimatePrizePicksCostUsd(5000,1),0.30);
});

test("shared budget targets 22 and hard-stops above 25", () => {
  assert.equal(evaluateSharedApifySpend({monthToDateUsd:21,estimatedRunUsd:0.5}).allowed,true);
  const throttle=evaluateSharedApifySpend({monthToDateUsd:21.9,estimatedRunUsd:0.2});
  assert.equal(throttle.allowed,false);
  assert.equal(throttle.mode,"THROTTLE");
  const stop=evaluateSharedApifySpend({monthToDateUsd:24.9,estimatedRunUsd:0.2,priority:true});
  assert.equal(stop.allowed,false);
  assert.equal(stop.mode,"STOP");
});

test("shared MTD adds ACTION and dedicated PrizePicks ledgers", async () => {
  const db={ async queryOne(sql) {
    if(sql.includes("shadow_cost_ledger")) return {mtd_usd:15,runs:10};
    if(sql.includes("apify_sports_cost_ledger")) return {mtd_usd:6,runs:20};
    return null;
  }};
  const x=await querySharedApifyMonthToDateUsd(db,{now:new Date("2026-10-01T12:00:00Z")});
  assert.equal(x.mtdUsd,21);
  assert.equal(x.runs,30);
});

test("PrizePicks normalization retains supplied player headshots", () => {
  const row=normalizePrizePicksProjection({
    projection_id:"p1", player_name:"Player A", player_image_url:"https://images.example/player.png",
    league:"NBA", stat_short:"PTS", line:22.5
  });
  assert.equal(row.playerHeadshotUrl,"https://images.example/player.png");
});


test("PrizePicks matchup enrichment derives opponent from matched FBIS event", () => {
  assert.equal(candidateOpponent({team:"PIT",home:"PIT",away:"CLE"},"PIT"),"CLE");
  assert.equal(candidateOpponent({team:"PIT",home:"PIT",away:"CLE"},"CLE"),"PIT");
  assert.equal(candidateOpponent({team:"PIT",opponent:"CLE"},null),"CLE");
});


test("PrizePicks payload team and opponent normalize from player/home/away fields", () => {
  const raw={player_team:"PIT",home_team:"CLE",away_team:"PIT"};
  assert.equal(teamOf(raw),"PIT");
  assert.equal(opponentOf(raw),"CLE");
});
