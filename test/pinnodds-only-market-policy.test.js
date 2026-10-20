import test from "node:test";
import assert from "node:assert/strict";
import {ACTIVE_ODDS_PROVIDER,ACTIVE_MARKET_FEEDS,ACTIVE_MARKET_SOURCES,isActiveOddsProvider,allowNewMarketObservation,retiredOddsCollectorResponse,
  pinnoddsOnlySlateMarket} from "../functions/lib/activeOddsPolicy.js";
import {selectPinnoddsBoardOffers} from "../functions/lib/pinnoddsBoardResearch.js";
test("sole active odds source is PinnOdds, no silent Parlay or soft bookmaker fallback",()=>{
 assert.equal(ACTIVE_ODDS_PROVIDER,"PinnOdds");
 for(const p of ["parlay","theodds","sharpapi","therundown","ACTION","Polymarket US","PrizePicks GitHub Mirror"])
  assert.equal(isActiveOddsProvider(p),false);
 assert.deepEqual(ACTIVE_MARKET_FEEDS,[
   "PinnOdds","Polymarket US","Polymarket US WebSocket","PrizePicks GitHub Mirror"
 ]);
 for(const source of ACTIVE_MARKET_FEEDS)assert.equal(allowNewMarketObservation({source}),true);
 for(const source of ["Parlay","SharpAPI","ACTION","PrizePicks paid/Apify","Kalshi"])
   assert.equal(allowNewMarketObservation({source}),false);
 assert.equal(isActiveOddsProvider("PinnOdds"),true);
 assert.equal(ACTIVE_MARKET_SOURCES.length,4);
 for(const source of ["PinnOdds","Polymarket US","Polymarket US WebSocket","PrizePicks GitHub Mirror"])
   assert.equal(allowNewMarketObservation({source}),true);
 for(const source of ["Parlay","ACTION","PrizePicks Paid Apify"])
   assert.equal(allowNewMarketObservation({source}),false);
 assert.equal(retiredOddsCollectorResponse("Parlay").blocked,true);
 const game=pinnoddsOnlySlateMarket({id:"401866441",sport:"cfb",odds:{homeMl:-150,pinHomeMl:-148},
   market:{reference:{homeMoneyline:-150}},pin:{spread:{noVigA:.55}},rec:{pick:"legacy"},lean:{pick:"legacy"},
   cfb:{dataQuality:0},model:{projHome:31}});
 assert.equal(game.odds.homeMl,undefined);
 assert.equal(game.odds.pinHomeMl,undefined);
 assert.equal(game.pin,null);assert.equal(game.market,null);
 assert.equal(game.rec,null);assert.equal(game.lean,null);
 assert.equal(game.canQualify,false);assert.equal(game.canAuthorizeWager,false);
 assert.equal(game.model.projHome,31);
});
const now="2026-10-14T23:00:00Z",collected_at="2026-10-14T22:30:00Z",event_start_time="2026-10-17T18:00:00Z";
const row=(market_family,side,line,decimal_odds,source="PinnOdds")=>({
 source,canonical_event_id:"401866441",period:"full_game",market_family,side,line,
 decimal_odds,source_observed_at:null,collected_at,event_start_time,
 source_market_id:market_family+"-"+(market_family==="spread"?Math.abs(line):line),source_outcome_id:side,
});
test("PinnOdds research supplies only paired capture-only full-game markets",()=>{
 const x=selectPinnoddsBoardOffers([
  row("moneyline","home",null,1.93),row("moneyline","away",null,1.95),
  row("spread","home",-7.5,1.93),row("spread","away",7.5,1.92),
  row("total","over",48.5,1.94),row("total","under",48.5,1.94),
  row("moneyline","home",null,2.5,"Parlay")],{now});
 const r=x["401866441"];
 assert.equal(r.source,"PinnOdds");assert.equal(r.offers.length,6);
 assert.deepEqual(r.pairedMarkets,["moneyline","spread","total"]);
 assert.equal(r.canAuthorizeWager,false);assert.equal(r.providerTimestampVerified,false);
 assert.equal(r.latestCapturedAt,collected_at);
});
test("unmatched, stale, wrong-period, post-kickoff and unsupported sources fail closed",()=>{
 const x=selectPinnoddsBoardOffers([
  {...row("moneyline","home",null,1.9),period:"num_1"},
  {...row("moneyline","away",null,1.9),collected_at:"2026-10-13T20:30:00Z"},
  {...row("moneyline","away",null,1.9),event_start_time:"2026-10-14T20:00:00Z"},
  row("moneyline","away",null,1.91,"SharpAPI")],{now});
 assert.equal(x["401866441"],undefined);
});
