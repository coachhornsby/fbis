import test from "node:test";
import assert from "node:assert/strict";
import { cachedKalshiShadow } from "../functions/lib/kalshiMarketCollector.js";
import {onRequestGet} from "../functions/api/kalshi-market-shadow.js";

function cache(){
 const values=new Map();
 return {
  async match(req){
   const row=values.get(req.url);
   return row && Date.now()<row.expires?new Response(JSON.stringify(row.body)):undefined;
  },
  async put(req,res){
   const ttl=Number(/max-age=(\d+)/.exec(res.headers.get("cache-control")||"")?.[1]||0);
   values.set(req.url,{body:await res.json(),expires:Date.now()+ttl*1000});
  },
 };
}
const mockMarket={ticker:"KXNFLGAME-26OCT25-TEAM",event_ticker:"KXNFLGAME-26OCT25",
 yes_bid_dollars:"0.45",yes_ask_dollars:"0.51",no_bid_dollars:"0.49"};
test("shared per-colo cache prevents repeated same-sport upstream GET fanout",async()=>{
 const store=cache(),now=new Date();
 let hits=0;
 const fetchImpl=async()=>{hits++;return Response.json({markets:[mockMarket],cursor:""});};
 const one=await cachedKalshiShadow({sport:"nfl",cache:store,now,fetchImpl});
 const two=await cachedKalshiShadow({sport:"nfl",cache:store,now,fetchImpl});
 assert.equal(one.ok,true);
 assert.equal(two.ok,true);
 assert.equal(one.collector,"EDGE_CACHE_MISS");
 assert.equal(two.collector,"EDGE_CACHE_HIT");
 assert.equal(two.cacheScope,"EDGE_COLO_NOT_GLOBAL");
 assert.equal(hits,1);
 assert.equal(two.records[0].executionEligible,false);
});
test("429 circuit breaker suppresses subsequent sport fetches and exposes retry-after",async()=>{
 const store=cache(),now=new Date();
 let hits=0;
 const fetchImpl=async()=>{hits++;return new Response("",{status:429,headers:{"retry-after":"140"}});};
 const limited=await onRequestGet({
   request:new Request("https://fbis.test/api/kalshi-market-shadow?sport=nfl"),
   fetchImpl,context:{cache:store},
 });
 assert.equal(limited.status,429);
 assert.equal(limited.headers.get("retry-after"),"140");
 const one=await limited.json();
 assert.equal(one.code,"KALSHI_PUBLIC_RATE_LIMITED");
 const other=await cachedKalshiShadow({sport:"cfb",cache:store,now,fetchImpl});
 assert.equal(other.collector,"EDGE_CACHE_COOLDOWN");
 assert.equal(other.rateLimited,true);
 assert.equal(hits,1);
});
test("shadow remains non-executable regardless of authority query or prior cache",async()=>{
 const store=cache(),fetchImpl=async()=>Response.json({markets:[mockMarket],cursor:""});
 const res=await onRequestGet({request:new Request("https://fbis.test/api/kalshi-market-shadow?sport=nfl&mode=authoritative&executionEligible=true"),fetchImpl,context:{cache:store}});
 assert.equal(res.status,200);
 const d=await res.json();
 assert.equal(d.governance.mode,"SHADOW_ONLY");
 assert.equal(d.records[0].executionEligible,false);
 assert.equal(d.records[0].canonicalEventId,null);
});
