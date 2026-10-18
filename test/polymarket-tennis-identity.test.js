import test from "node:test";
import assert from "node:assert/strict";
import {loadVerifiedTennisCandidates} from "../functions/lib/polymarketTennisIdentity.js";
import {capturePolymarketPage} from "../functions/lib/polymarketCapture.js";
const start="2026-10-15T15:30:00Z";
const event={id:"us-158278",seriesSlug:"wta",title:"Elsa Jacquemot vs. Teodora Kostovic",
 startTime:start,markets:[{id:"ml",slug:"wta-jacquemot-kostovic",
 sportsMarketTypeV2:"SPORTS_MARKET_TYPE_MONEYLINE",
 marketSides:[{id:"a",description:"Elsa Jacquemot",quote:{value:.51}},{id:"b",description:"Teodora Kostovic",quote:{value:.49}}]}]};
const official={id:"WTA_OFFICIAL:fixture-1",start,tour:"wta",away_name:"Teodora Kostović",home_name:"Elsa Jacquemot"};
function mockDb(rows){
 return {prepare(sql){
  assert.match(sql,/tennis_official_matches/);
  assert.match(sql,/ATP_OFFICIAL/);
  assert.match(sql,/WTA_OFFICIAL/);
  assert.match(sql,/JOIN tennis_players/);
  return {bind(from,until){
   assert.ok(Date.parse(from)<Date.parse(start));
   assert.ok(Date.parse(until)>Date.parse(start));
   return {async all(){return {results:rows}}};
  }};
 }};
}

test("only verified source-backed official candidates enter Polymarket tennis matching",async()=>{
 const rows=await loadVerifiedTennisCandidates(mockDb([official]),[start]);
 assert.deepEqual(rows,[official]);
 assert.deepEqual(await loadVerifiedTennisCandidates(mockDb([]),[start]),[]);
 assert.deepEqual(await loadVerifiedTennisCandidates(mockDb([]),[]),[]);
});
test("paginated US tennis receipt links verified WTA fixture but never modifies source timestamps",async()=>{
 const records=new Map();
 const env={DB:mockDb([official]),ARCHIVE:{async get(k){return records.has(k)?{json:async()=>JSON.parse(records.get(k))}:null},
  async put(k,value){records.set(k,value)}}};
 const capturedAt=new Date("2026-10-15T10:00:00Z");
 const receipt=await capturePolymarketPage(env,{receiptId:"tennis-test-1",kind:"events",slug:"wta",sport:"tennis",
  fetchImpl:async()=>new Response(JSON.stringify({events:[event]})),now:capturedAt});
 assert.equal(receipt.expectedRows,2);
 const saved=JSON.parse(records.get("market-sources/polymarket-us/receipts/tennis-test-1.json"));
 assert.equal(saved.offers[0].eventId,official.id);
 assert.equal(saved.offers[0].raw.eventMatchStatus,"TENNIS_TWO_PLAYER_START_VERIFIED");
 assert.equal(saved.offers[0].fetchedAt,capturedAt.toISOString());
 assert.equal(saved.offers[0].raw.sourceObservedAt,null);
 assert.equal(saved.offers[0].executionEligible,false);
 assert.equal(saved.offers[0].raw.canAuthorizeWager,false);
});
test("provider quotes without an independent official fixture remain research only and unlinked",async()=>{
 const records=new Map();
 const env={DB:mockDb([]),ARCHIVE:{async get(){return null},async put(k,v){records.set(k,v)}}};
 await capturePolymarketPage(env,{receiptId:"tennis-test-unlinked",kind:"events",slug:"wta",sport:"tennis",
  fetchImpl:async()=>new Response(JSON.stringify({events:[event]})),now:new Date("2026-10-15T10:00:00Z")});
 const raw=JSON.parse(records.get("market-sources/polymarket-us/receipts/tennis-test-unlinked.json"));
 assert.ok(raw.offers.every(o=>o.eventId===null&&o.raw.eventMatchStatus==="UNMATCHED_TENNIS_EVENT"&&!o.canAuthorizeWager));
});

test('WTA-verified Caty alias still requires both players, tour and start',async()=>{
 const {matchPolymarketUsEvent}=await import('../functions/lib/polymarketUs.js');
 const fixture={id:'osaka-verified',start:'2026-10-19T04:00:00Z',tour:'wta',away_name:'Catherine McNally',home_name:'Sinja Kraus'};
 const source={title:'Caty Mcnally vs. Sinja Kraus',startTime:fixture.start,seriesSlug:'wta'};
 assert.equal(matchPolymarketUsEvent(source,[fixture],'tennis').id,fixture.id);
 assert.equal(matchPolymarketUsEvent(source,[{...fixture,home_name:'Other Player'}],'tennis').id,null);
 assert.equal(matchPolymarketUsEvent(source,[{...fixture,tour:'atp'}],'tennis').id,null);
 assert.equal(matchPolymarketUsEvent({...source,startTime:'2026-10-20T04:00:00Z'},[fixture],'tennis').id,null);
});
