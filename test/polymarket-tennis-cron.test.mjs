import test from "node:test";
import assert from "node:assert/strict";
import worker,{collectTennisOnSchedule}
 from "../services/polymarket-tennis-collector/index.js";
import {TENNIS_EXCHANGE_INVENTORY_KEY,loadPolymarketUsTennisInventory}
 from "../functions/lib/tennisExchangeInventory.js";

const now=new Date("2026-10-21T14:40:00Z");
const item={id:"atp-427",slug:"atp-oribat-dimsak-2026-10-21",
 title:"Oriol Roca Batalla vs. Dimitris Sakellaridis",seriesSlug:"atp-2026",
 startTime:"2026-10-21T17:00:00Z",marketCounts:{numMarkets:19},
 markets:[{id:"427",sportsMarketTypeV2:"SPORTS_MARKET_TYPE_MONEYLINE",
  marketSides:[{id:"home",long:true,description:"Oriol Roca Batalla",price:"0.70"},
   {id:"away",long:false,description:"Dimitris Sakellaridis",price:"0.31"}]}]};
function fakeEnv(){
 const saved=new Map();
 return {saved,env:{ARCHIVE:{
   put:async(k,v)=>{saved.set(k,JSON.parse(v))},
   get:async k=>saved.has(k)?{json:async()=>saved.get(k)}:null}}};
}
test("scheduled Worker refreshes R2 from Polymarket directly without ESPN, DB or secret",async()=>{
 const {saved,env}=fakeEnv();
 const fetchImpl=async url=>{
  const u=new URL(url);
  return Response.json({events:u.searchParams.get("tagSlug")==="atp"?[item]:[]});
 };
 const result=await collectTennisOnSchedule(env,{now,fetchImpl});
 assert.equal(result.status,"CAPTURED");
 assert.equal(result.atp,1);
 assert.equal(result.wta,0);
 assert.ok(saved.has(TENNIS_EXCHANGE_INVENTORY_KEY));
 const diag=await worker.fetch(new Request("https://example.org/health"),env);
 assert.equal(diag.status,200);
 const status=await diag.json();
 assert.equal(status.readOnly,true);
 assert.equal(status.schedule,"EVERY_5_MINUTES");
 assert.equal(status.canAuthorizeWager,false);
 const snapshot=await loadPolymarketUsTennisInventory(env.ARCHIVE,{now});
 assert.equal(snapshot.ok,true);
 assert.equal(snapshot.fresh,true);
 assert.equal(snapshot.events.length,1);
 assert.equal(snapshot.events[0].offers.length,2);
});
test("stale quotes disappear but exchange match identities survive scheduled delays",async()=>{
 const {env}=fakeEnv();
 const source={version:1,source:"POLYMARKET_US_PUBLIC",
  capturedAt:now.toISOString(),complete:true,events:[{
   id:"tennis:polyus:atp:427",start:"2026-10-21T17:00:00Z",
   tour:"atp",player1:"Oriol Roca Batalla",player2:"Dimitris Sakellaridis",
   offers:[{source:"Polymarket US",contractPrice:.7}]}]};
 await env.ARCHIVE.put(TENNIS_EXCHANGE_INVENTORY_KEY,JSON.stringify(source));
 const stale=await loadPolymarketUsTennisInventory(env.ARCHIVE,{
  now:new Date(+now+31*60000)});
 assert.equal(stale.ok,true);
 assert.equal(stale.fresh,false);
 assert.equal(stale.code,"STALE_LISTINGS_NO_QUOTES");
 assert.equal(stale.events.length,1);
 assert.deepEqual(stale.events[0].offers,[]);
 const expired=await loadPolymarketUsTennisInventory(env.ARCHIVE,{
  now:new Date(+now+25*3600000)});
 assert.equal(expired.ok,false);
});
test("Worker exposes no public trigger for collector and no wager routes",async()=>{
 const {env}=fakeEnv();
 const r=await worker.fetch(new Request("https://example.org/refresh",{
  method:"POST"}),env);
 assert.equal(r.status,404);
 assert.equal((await r.json()).code,"READ_ONLY_HEALTH_ONLY");
});
