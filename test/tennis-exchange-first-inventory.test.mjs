import test from "node:test";
import assert from "node:assert/strict";
import {buildTennisResearchSlate,buildTodayBoard} from "../functions/lib/todayBoard.js";
import {matchKalshiTennisResearch} from "../functions/lib/tennisKalshiResearch.js";
import {
 collectPolymarketUsTennisInventory,loadPolymarketUsTennisInventory,
 mergePolymarketUsTennisCards,normalizePolymarketUsTennisEvent,
 tennisExchangePlayers,TENNIS_EXCHANGE_INVENTORY_KEY
} from "../functions/lib/tennisExchangeInventory.js";

const now=new Date("2026-10-21T14:00:00Z");
const event=(title="Oriol Roca Batalla vs. Dimitris Sakellaridis",id="atp-123")=>({
 id,slug:"atp-oribat-dimsak-2026-10-21",seriesSlug:"atp",title,
 startTime:"2026-10-21T17:00:00Z",
 marketCounts:{numMarkets:19},
 markets:[{id:"m1",slug:"m1",sportsMarketTypeV2:"SPORTS_MARKET_TYPE_MONEYLINE",
  marketSides:[{id:"a",long:true,description:"Oriol Roca Batalla",price:{value:".81"}},
   {id:"b",long:false,description:"Dimitris Sakellaridis",price:{value:".20"}}]}]
});
test("source event creates market identity without any ESPN fixture, score or model",()=>{
 const x=normalizePolymarketUsTennisEvent(event(),"atp",now);
 assert.equal(x.id,"tennis:polyus:atp:atp-123");
 assert.equal(x.marketCount,19);
 assert.equal(x.offers.length,2);
 assert.equal(x.offers[0].contractPrice,.81);
 assert.equal(x.offers[0].canAuthorizeWager,false);
 assert.equal(normalizePolymarketUsTennisEvent(event(),"wta",now),null);
 assert.equal(tennisExchangePlayers("Player One / Player Two vs. Player Three"),null);
});
test("collector pages ATP and WTA source markets directly, without calling ESPN or DB",async()=>{
 const store=new Map(),calls=[];
 const env={ARCHIVE:{
  put:async(k,v)=>store.set(k,JSON.parse(v)),
  get:async k=>store.has(k)?{json:async()=>store.get(k)}:null}};
 const fetchImpl=async url=>{
  const u=new URL(url);calls.push(u.pathname+":"+u.searchParams.get("tagSlug"));
  const sport=u.searchParams.get("tagSlug");
  return Response.json({events:sport==="atp"?[event()]:[]});
 };
 const result=await collectPolymarketUsTennisInventory(env,{now,fetchImpl});
 assert.equal(result.events,1);
 assert.equal(result.atp,1);
 assert.equal(result.complete,true);
 assert.deepEqual(calls,["/v1/events:atp","/v1/events:wta"]);
 assert.ok(store.has(TENNIS_EXCHANGE_INVENTORY_KEY));
 const loaded=await loadPolymarketUsTennisInventory(env.ARCHIVE,{now});
 assert.equal(loaded.ok,true);
 const board=mergePolymarketUsTennisCards([],loaded,{date:"2026-10-21",now});
 assert.equal(board.added.length,1);
 assert.equal(board.games[0].tennisProjection.player1WinProb,null);
 assert.equal(board.games[0].tennisProjection.venueOffers.length,2);
 assert.equal(board.games[0].tennisProjection.researchFixture.source,"POLYMARKET_US_PUBLIC");
 assert.equal(board.games[0].canAuthorizeWager,false);
 const old=await loadPolymarketUsTennisInventory(env.ARCHIVE,{now:new Date(+now+30*60000)});
 assert.equal(old.ok,true);
 assert.equal(old.fresh,false);
 assert.equal(old.code,"STALE_LISTINGS_NO_QUOTES");
 assert.deepEqual(old.events[0].offers,[]);
});
test("exchange inventory attaches to existing independent FBIS projection without changing its probability",()=>{
 const e=normalizePolymarketUsTennisEvent(event(),"atp",now);
 const model={sport:"tennis",id:"official-1",tour:"atp",
  start:"2026-10-21T17:00:00Z",
  home:{name:"Dimitris Sakellaridis"},away:{name:"Oriol Roca Batalla"},
  tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.63,venueOffers:[]}};
 const r=mergePolymarketUsTennisCards([model],{ok:true,code:"SOURCE_COMPLETE",events:[e]},
  {date:"2026-10-21",now});
 assert.equal(r.matchedExisting,1);
 assert.equal(r.added.length,0);
 assert.equal(r.games[0].tennisProjection.player1WinProb,.63);
 assert.equal(r.games[0].tennisProjection.venueOffers.length,2);
 assert.equal(r.games[0].tennisProjection.venueOffers.find(x=>x.participantName==="Oriol Roca Batalla").side,"away");
 assert.equal(r.games[0].tennisProjection.venueOffers.find(x=>x.participantName==="Dimitris Sakellaridis").side,"home");
});
test("uncertain doubles, duplicate match identity and mismatched day never authorizes or creates a model",()=>{
 assert.equal(normalizePolymarketUsTennisEvent(event("Player One / Player Two vs. Player Three"),"atp",now),null);
 const e=normalizePolymarketUsTennisEvent(event(),"atp",now);
 const same={sport:"tennis",tour:"atp",start:e.start,
  home:{name:e.player1},away:{name:e.player2},
  tennisProjection:{player1WinProb:.4}};
 const r=mergePolymarketUsTennisCards([same,{...same,id:"conflicting"}],
  {ok:true,code:"SOURCE_COMPLETE",events:[e]}, {date:"2026-10-21",now});
 assert.equal(r.matchedExisting,0);
 assert.equal(r.added.length,1);
 assert.equal(r.games[2].tennisProjection.player1WinProb,null);
 const out=mergePolymarketUsTennisCards([],
  {ok:true,code:"SOURCE_COMPLETE",events:[e]}, {date:"2026-10-22",now});
 assert.equal(out.games.length,0);
});

test("birth-year disambiguator from Polymarket does not block two-party Kalshi match",()=>{
 const fixture={tour:"atp",start:"2026-10-21T17:00:00Z",
  home_name:"Kenta (2004) Miyoshi",away_name:"Patrick Maloney"};
 const base={sport:"atp",status:"active",eventTicker:"KXATPMATCH-26OCT21MIYMAL",
  expectedExpirationAt:"2026-10-21T17:00:00Z",
  fetchedAt:"2026-10-21T13:50:00Z",
  rulesPrimary:"This professional tennis match features Patrick Maloney and Kenta Miyoshi."};
 const rows=[
  {...base,yesLabel:"Patrick Maloney",ticker:base.eventTicker+"-MAL",yesAskDollars:.44},
  {...base,yesLabel:"Kenta Miyoshi",ticker:base.eventTicker+"-MIY",yesAskDollars:.57}];
 const matched=matchKalshiTennisResearch(fixture,rows,now);
 assert.equal(matched.length,2);
 assert.ok(matched.every(x=>x.canAuthorizeWager===false));
});

test("Polymarket US matches publish without model D1 or ESPN fixture database",async()=>{
 const source=normalizePolymarketUsTennisEvent(event(),"atp",now);
 const snapshot={version:1,source:"POLYMARKET_US_PUBLIC",
  complete:true,capturedAt:now.toISOString(),events:[source]};
 const env={ARCHIVE:{get:async key=>key===TENNIS_EXCHANGE_INVENTORY_KEY?
  {json:async()=>snapshot}:null}};
 const slate=await buildTennisResearchSlate("2026-10-21",env,{now});
 assert.equal(slate.games.length,1);
 assert.equal(slate.games[0].tennisProjection.researchFixture.source,"POLYMARKET_US_PUBLIC");
 assert.equal(slate.games[0].tennisProjection.player1WinProb,null);
 assert.equal(slate.research.modelStatus,"MODEL_DATABASE_UNAVAILABLE");
 assert.equal(slate.games[0].canAuthorizeWager,false);
});

test("prior-day Polymarket match still active remains discoverable without changing start",()=>{
 const live={...event("Yanaki Milev vs. Lorenzo Giustino","171238"),
  startTime:"2026-10-20T14:45:00Z"};
 const discovered=normalizePolymarketUsTennisEvent(live,"atp",now);
 assert.ok(discovered);
 assert.equal(discovered.start,"2026-10-20T14:45:00.000Z");
 assert.equal(normalizePolymarketUsTennisEvent({...live,startTime:"2026-10-18T02:00:00Z"},"atp",now),null);
});

test("D1 query failure cannot suppress independently collected Polymarket market cards",async()=>{
 const record=normalizePolymarketUsTennisEvent(event(),"atp",now);
 const snapshot={version:1,source:"POLYMARKET_US_PUBLIC",
  capturedAt:now.toISOString(),complete:true,events:[record]};
 const calls=[];
 const env={DB:{prepare:sql=>{calls.push(sql);throw Error("SIMULATED_D1_FAILURE");}},
  ARCHIVE:{get:async key=>key===TENNIS_EXCHANGE_INVENTORY_KEY?
   {json:async()=>snapshot}:null}};
 const board=await buildTennisResearchSlate("2026-10-21",env,{now});
 assert.equal(board.research.modelStatus,"MODEL_D1_READ_FAILED");
 assert.equal(board.games.length,1);
 assert.equal(board.games[0].tennisProjection.venueOffers.length,2);
 assert.equal(board.games[0].canAuthorizeWager,false);
 assert.equal(calls.length,1);
 // Date/identity checks still govern which source events appear.
 assert.equal(board.games[0].tennisProjection.researchFixture.source,"POLYMARKET_US_PUBLIC");
});
test("market-first model query restricts historical market/context ranking to selected fixture IDs",async()=>{
 const snapshot={version:1,source:"POLYMARKET_US_PUBLIC",
  capturedAt:now.toISOString(),complete:true,
  events:[normalizePolymarketUsTennisEvent(event(),"atp",now)]};
 const sql=[];
 const env={DB:{prepare:q=>{sql.push(q);return{bind:()=>({
  all:async()=>({results:[]})})}}},ARCHIVE:{get:async key=>
  key===TENNIS_EXCHANGE_INVENTORY_KEY?{json:async()=>snapshot}:null}};
 const board=await buildTennisResearchSlate("2026-10-21",env,{now});
 assert.equal(board.games.length,1);
 assert.ok(sql[0].includes("FROM tennis_market_snapshots\n        WHERE canonical_event_id IN"));
 assert.ok(sql[0].includes("FROM tennis_context_snapshots\n        WHERE canonical_event_id IN"));
 assert.equal(board.research.modelGameCount,0);
});

test("focused TODAY board preserves Polymarket cards and avoids historical D1 overlay",async()=>{
 const item=normalizePolymarketUsTennisEvent(event(),"atp",now);
 const data={version:1,source:"POLYMARKET_US_PUBLIC",capturedAt:now.toISOString(),
  complete:true,events:[item]};
 const dbSql=[];
 const env={ARCHIVE:{get:async key=>key===TENNIS_EXCHANGE_INVENTORY_KEY?
  {json:async()=>data}:null},
  DB:{prepare:sql=>{dbSql.push(sql);throw Error("OPTIONAL_MODEL_DB_UNAVAILABLE");}}};
 const board=await buildTodayBoard("2026-10-21",env,{
  now:+now,focusSport:"tennis"});
 const tennis=board.games.filter(x=>x.sport==="tennis");
 assert.equal(tennis.length,1);
 const offers=tennis[0].tennisProjection?.venueOffers||tennis[0].market?.venueOffers||[];
 assert.equal(offers.length,2);
 assert.equal(board.polymarketResearch.bySport.tennis.available,true);
 assert.equal(board.polymarketResearch.bySport.tennis.diagnostics.d1HistoricalLedgerSkipped,true);
 assert.ok(dbSql.some(sql=>sql.includes("FROM tennis_v2_research_decisions")));
 // Other optional board diagnostics can query D1, but the Tennis-specific
 // Polymarket history overlay was skipped (verified by the board metadata).
});
