import test from "node:test";
import assert from "node:assert/strict";
import {loadVerifiedTennisCandidates} from "../functions/lib/polymarketTennisIdentity.js";
import {matchPolymarketUsEvent} from "../functions/lib/polymarketUs.js";
import {normalizePinnoddsMarkets} from "../functions/lib/pinnoddsMarkets.js";

const eventStart="2026-10-14T06:00:00.000Z";
const fixture={id:"tennis:espn:wta:381-2026:185348",start:eventStart,tour:"wta",
 away_name:"Jessica Pegula",home_name:"Jelena Ostapenko",sport:"tennis",fixture_source:"ESPN_PUBLIC"};
function db(rows=[fixture]){
 return {prepare(sql){assert.match(sql,/tennis_external_fixtures/);assert.match(sql,/fetched_at>=/);
  return{bind(...values){assert.equal(values.length,4);assert.match(sql,/fetched_at\)<=julianday\(\?4\)/);return{async all(){return{results:rows}}}}}}};
}
test("independent WTA fixture resolves exact two-player Polymarket match (not a sportsbook ID)",async()=>{
 const games=await loadVerifiedTennisCandidates(db(),[eventStart]);
 assert.equal(games.length,1);
 const result=matchPolymarketUsEvent({id:"exchange-event",title:"Jessica Pegula vs. Jelena Ostapenko",
  seriesSlug:"wta",startTime:eventStart,markets:[]},games,"tennis");
 assert.deepEqual(result,{id:fixture.id,reason:"TENNIS_TWO_PLAYER_START_VERIFIED"});
});
test("PinnOdds WTA moneylines link to an independent tennis fixture with preserved prices and research-only governance",async()=>{
 const games=await loadVerifiedTennisCandidates(db(),[eventStart]);
 const parent={event_id:12345,home:"Jessica Pegula",away:"Jelena Ostapenko",
  league_name:"WTA Singles",starts:eventStart,
  periods:{num_0:{number:0,money_line:{home:1.8,away:2.05}}}};
 const r=normalizePinnoddsMarkets({events:[parent]},{
  sportId:2,feed:"prematch",capturedAt:"2026-10-14T05:00:00Z",games,
  snapshotId:"synthetic-test-receipt",rawKey:"synthetic-test-raw"});
 assert.equal(r.matchedRows,2);
 assert.deepEqual(new Set(r.rows.map(x=>x.eventId)),new Set([fixture.id]));
 assert.ok(r.rows.every(x=>x.executionEligible===false&&x.sourceObservedAt===null));
});
test("no matching fixture leaves both market sources unmatched",()=>{
 const p=matchPolymarketUsEvent({title:"Jessica Pegula vs. Jelena Ostapenko",
  seriesSlug:"wta",startTime:eventStart},[],"tennis");
 assert.equal(p.id,null);
 const r=normalizePinnoddsMarkets({events:[{event_id:12345,home:"Jessica Pegula",away:"Jelena Ostapenko",
  league_name:"WTA Singles",starts:eventStart,periods:{num_0:{money_line:{home:1.8,away:2.05}}}}]},{
  sportId:2,feed:"prematch",capturedAt:"2026-10-14T05:00:00Z",games:[],snapshotId:"x",rawKey:"raw"});
 assert.equal(r.matchedRows,0);
});

test("fixture lookup uses capture-time cutoff rather than later hydration time",async()=>{
 const asOf="2026-10-14T05:00:00Z";
 let captured;
 const database={prepare(sql){assert.match(sql,/m.observed_at\)<=julianday\(\?4\)/);
  assert.match(sql,/f.fetched_at\)<=julianday\(\?4\)/);
  return {bind(...args){captured=args;return {async all(){return {results:[]}}}}};}};
 await loadVerifiedTennisCandidates(database,[eventStart],{asOf});
 assert.equal(captured[3],asOf);
 assert.equal(captured[2],"2026-10-13T11:00:00.000Z");
});
