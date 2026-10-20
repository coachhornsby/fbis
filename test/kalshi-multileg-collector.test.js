import test from "node:test";
import assert from "node:assert/strict";
import {captureKalshiMultilegs,normalizeKalshiMultileg} from "../functions/lib/kalshiMultilegCollector.js";
const root="player-props/kalshi/v1/";
function archive(){const rows=new Map();return{rows,async get(k){return rows.has(k)?{json:async()=>JSON.parse(rows.get(k))}:null},async put(k,v){rows.set(k,v)}}}
const event={event_ticker:"KXMVE-FOO",title:"Two player outcomes"};
const market={ticker:"KXMVE-FOO-ABC",event_ticker:event.event_ticker,mve_collection_ticker:"KXMVE",yes_ask_dollars:"0.28",yes_ask_size_fp:"3",mve_selected_legs:[{market_ticker:"KXPLAYER-A",event_ticker:"KXEVENT-A",side:"yes"},{market_ticker:"KXPLAYER-B",event_ticker:"KXEVENT-B",side:"no"}]};
test("multi-leg cards only accept provider-declared distinct valid legs",()=>{
 const v=normalizeKalshiMultileg(market,event);
 assert.equal(v.legCount,2);assert.equal(v.providerAskDollars,.28);
 assert.equal(v.rfqQuoteVerified,false);assert.equal(v.jointModelProbability,null);
 assert.equal(v.executionEligible,false);
 assert.equal(normalizeKalshiMultileg({...market,mve_selected_legs:[market.mve_selected_legs[0]]},event),null);
 assert.equal(normalizeKalshiMultileg({...market,mve_selected_legs:[market.mve_selected_legs[0],market.mve_selected_legs[0]]},event),null);
});
test("one bounded public page checkpoints and publishes on empty cursor",async()=>{
 const ARCHIVE=archive(),now=new Date("2026-10-20T15:00:00Z");
 let calls=0;
 const fetchImpl=async(url,init)=>{calls++;assert.equal(init.method,"GET");assert.equal(new URL(url).pathname,"/trade-api/v2/events/multivariate");
 return Response.json({events:[{...event,markets:[market]}],cursor:calls===1?"NEXT":""})};
 const first=await captureKalshiMultilegs({ARCHIVE},{now,fetchImpl});
 assert.equal(first.status,"PAGINATING");
 assert.equal(ARCHIVE.rows.has(root+"multi-snapshot.json"),false);
 const second=await captureKalshiMultilegs({ARCHIVE},{now:new Date(now.getTime()+16*60000),fetchImpl});
 assert.equal(second.status,"CAPTURED");assert.equal(calls,2);
 const saved=JSON.parse(ARCHIVE.rows.get(root+"multi-snapshot.json"));
 assert.equal(saved.records.length,1);assert.equal(saved.paginationComplete,true);
 assert.equal(saved.canAuthorizeWager,false);
});
test("provider 429 leaves no invented combo prices or snapshots",async()=>{
 const ARCHIVE=archive(),now=new Date("2026-10-20T15:00:00Z");
 const result=await captureKalshiMultilegs({ARCHIVE},{now,fetchImpl:async()=>new Response("",{status:429})});
 assert.equal(result.code,"MULTIVARIATE_RATE_LIMITED");
 assert.equal(ARCHIVE.rows.has(root+"multi-snapshot.json"),false);
});
