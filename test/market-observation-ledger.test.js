import test from "node:test";import assert from "node:assert/strict";
import { persistNormalizedMarketObservation,linkMarketDecision,latestVenueOffers } from "../functions/lib/marketObservationLedger.js";
function dbMock(){const calls=[];return {calls,prepare(sql){return {bind(...args){calls.push({sql,args});return {async run(){return {meta:{changes:1}}},async all(){return {results:[{source:"draftkings",source_type:"sportsbook",market_family:"moneyline",side:"home",american_odds:-115,collected_at:"2026-10-07T12:00:00Z"}]}}}}}}}}
test("normalized ledger is append-only and governance fail-closed",async()=>{const db=dbMock();const r=await persistNormalizedMarketObservation(db,{source:"draftkings",sourceType:"sportsbook",sport:"tennis",eventId:"e1",marketFamily:"moneyline",side:"home",americanOdds:-115,fetchedAt:"2026-10-07T12:00:00Z"},{modelProbability:.58,pairedAmericanOdds:105,collectedAt:"2026-10-07T12:01:00Z"});assert.equal(r.inserted,true);const call=db.calls[0];assert.match(call.sql,/INSERT OR IGNORE/);assert.match(call.sql,/can_qualify/);assert.match(call.sql,/can_authorize_wager/);assert.ok(call.args.includes("draftkings"));assert.ok(call.args.includes(.58));});
test("decision links preserve explicit timestamp and role",async()=>{const db=dbMock();const r=await linkMarketDecision(db,{decisionId:"d1",observationId:"o1",role:"ENTRY",decisionTimestamp:"2026-10-07T12:02:00Z"});assert.equal(r.inserted,true);assert.ok(db.calls[0].args.includes("ENTRY"));});
test("latest venue query partitions by source and threshold",async()=>{const db=dbMock();const rows=await latestVenueOffers(db,{sport:"tennis",eventId:"e1"});assert.equal(rows[0].source,"draftkings");assert.match(db.calls[0].sql,/PARTITION BY source,market_family/);});

test("current-board venue reads require recent collection and source clocks, and reject completed-event prices",async()=>{
 const db=dbMock();
 await latestVenueOffers(db,{sport:"nfl",eventId:"e1",now:new Date("2026-10-12T06:00:00Z"),maxAgeMs:900000});
 const call=db.calls[0];
 assert.match(call.sql,/collected_at BETWEEN/);
 assert.match(call.sql,/source_observed_at.*BETWEEN/);
 assert.match(call.sql,/event_start_time IS NULL OR event_start_time>=/);
 assert.deepEqual(call.args,["nfl","e1","2026-10-12T05:45:00.000Z","2026-10-12T06:00:00.000Z","2026-10-12T05:45:00.000Z","2026-10-12T06:00:00.000Z","2026-10-10T18:00:00.000Z",100]);
});
test("invalid current-board read clocks fail closed before SQL",async()=>{
 const db=dbMock();
 assert.deepEqual(await latestVenueOffers(db,{sport:"nfl",eventId:"e1",now:"invalid-date"}),[]);
 assert.deepEqual(await latestVenueOffers(db,{sport:"nfl",eventId:"e1",maxAgeMs:-1}),[]);
 assert.equal(db.calls.length,0);
});

test("identical lines in distinct periods receive distinct immutable observation IDs",async()=>{
 const offer={source:'PinnOdds',sourceType:'sportsbook',sport:'mlb',eventId:'game',marketFamily:'total',side:'over',line:4.5,decimalOdds:1.9,sourceMarketId:'market',sourceOutcomeId:'over',sourceObservedAt:null};
 const opts={collectedAt:'2026-10-13T17:00:00Z'},db=dbMock();
 const full=await persistNormalizedMarketObservation(db,{...offer,period:'full_game'},opts);
 const first=await persistNormalizedMarketObservation(db,{...offer,period:'first_five'},opts);
 assert.notEqual(full.id,first.id);
});
