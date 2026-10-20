import test from "node:test";
import assert from "node:assert/strict";
import {collectPolymarketGlobalTennis,loadPolymarketGlobalTennisSnapshot,matchPolymarketGlobalTennis} from "../functions/lib/tennisPolymarketGlobal.js";

const now=new Date("2026-10-20T14:55:00.000Z");
const fixture={id:"tennis:espn:atp:708-2026:185013",tour:"atp",
 away_name:"Timofey Skatov",home_name:"Fabian Marozsan",start:"2026-10-20T14:00:00.000Z"};
const event={id:"gamma-1",slug:"atp-marozsa-skatov-2026-10-20",
 title:"Marozsan vs. Skatov",gameStartTime:fixture.start,closed:false,
 markets:[{id:"market-1",active:true,closed:false,
  question:"Marozsan vs Skatov",
  outcomes:'["Marozsan","Skatov"]',outcomePrices:'["0.62","0.38"]'}]};
test("paired surnames, timestamp and tour produce only research metadata",()=>{
 const r=matchPolymarketGlobalTennis(fixture,[event],{now});
 assert.equal(r.length,1);
 assert.deepEqual(r[0].indicativePrices,[.62,.38]);
 assert.equal(r[0].quoteSourceTime,null);
 assert.equal(r[0].canAuthorizeWager,false);
 assert.equal(r[0].executionEligible,false);
});
test("reject different players, missing clocks, ambiguous events, stale evidence",()=>{
 assert.equal(matchPolymarketGlobalTennis({...fixture,home_name:"Tallon Griekspoor"},[event],{now}).length,0);
 assert.equal(matchPolymarketGlobalTennis(fixture,[{...event,gameStartTime:null}],{now}).length,0);
 assert.equal(matchPolymarketGlobalTennis(fixture,[event,{...event,id:"gamma-other"}],{now}).length,0);
 assert.equal(matchPolymarketGlobalTennis(fixture,[{...event,markets:[{...event.markets[0],outcomePrices:'["1.25","-0.25"]'}]}],{now}).length,0);
});
test("scheduled discovery archives and read path expires without spoofed quote clocks",async()=>{
 let snapshot=null,called=0;
 const db={prepare:()=>({bind:()=>({all:async()=>({results:[{fixture_id:fixture.id,...fixture}]})})})};
 const archive={put:async(k,v)=>{assert.match(k,/research-snapshot/);snapshot=JSON.parse(v)},
  get:async()=>({json:async()=>snapshot})};
 const fetchImpl=async uri=>{called++;assert.match(uri,/gamma-api\.polymarket\.com\/public-search/);
  return {ok:true,json:async()=>({events:[event]})};};
 const result=await collectPolymarketGlobalTennis({DB:db,ARCHIVE:archive},{now,fetchImpl});
 assert.equal(result.ok,true);
 assert.equal(result.matchedEvents,1);
 assert.equal(called,1);
 assert.equal(snapshot.quoteSourceTime,null);
 assert.equal(snapshot.canAuthorizeWager,false);
 const loaded=await loadPolymarketGlobalTennisSnapshot(archive,{now});
 assert.equal(loaded.ok,true);
 assert.equal(loaded.events.length,1);
 const stale=await loadPolymarketGlobalTennisSnapshot(archive,{now:new Date(+now+31*60000)});
 assert.equal(stale.ok,false);
});

test("collector captures CLOB best available asks without manufacturing quote-source clocks",async()=>{
 let snapshot=null;
 const db={prepare:()=>({bind:()=>({all:async()=>({results:[{fixture_id:fixture.id,...fixture}]})})})};
 const archive={put:async(key,value)=>{if(key.endsWith("research-snapshot-v1.json"))snapshot=JSON.parse(value)}};
 const market={...event.markets[0],clobTokenIds:JSON.stringify(["123456789012345678901","223456789012345678901"])};
 let reads=0;
 const fetchImpl=async url=>{
  reads++;
  if(url.includes("public-search"))return {ok:true,json:async()=>({events:[{...event,markets:[market]}]})};
  assert.match(url,/clob\.polymarket\.com\/book\?token_id=/);
  return {ok:true,json:async()=>({asks:[{price:"0.52",size:"9"},{price:"0.51",size:"4"}],bids:[{price:"0.49",size:"8"}]})};
 };
 const r=await collectPolymarketGlobalTennis({DB:db,ARCHIVE:archive},{now,fetchImpl});
 assert.equal(r.matchedEvents,1);
 assert.equal(reads,3);
 const clob=snapshot.events[0].markets[0].researchClob;
 assert.equal(clob.sides[0].bestAsk.price,.51);
 assert.equal(clob.sides[0].bestAsk.size,4);
 assert.equal(clob.sides[0].sourceQuoteTime,null);
 assert.equal(clob.canAuthorizeWager,false);
});
