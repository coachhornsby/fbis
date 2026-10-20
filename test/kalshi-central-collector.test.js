import test from "node:test";
import assert from "node:assert/strict";
import collector,{selectedSport,selectedAuxScope,collectKalshiPublicOnce,collectKalshiEvidenceOnce,relaySignedPages} from "../services/kalshi-public-collector/index.js";
import {loadKalshiR2Shadow} from "../functions/lib/kalshiR2Shadow.js";
import {onRequestGet} from "../functions/api/kalshi-market-shadow.js";

const key="kalshi/public-shadow/v1/";
function archive(){
 const records=new Map();
 return {records,async get(k){const body=records.get(k);return body===undefined?null:{json:async()=>JSON.parse(body)};},
  async put(k,v){records.set(k,String(v));}};
}
function atSport(sport){
 const start=Date.parse("2026-10-20T00:00:00Z");
 for(let i=0;i<100;i++){
  const d=new Date(start+i*15*60*1000);
  if(selectedSport(d)===sport)return d;
 }
 throw Error("sport slot not found");
}
function market(sport){
 const ticker=sport==="nfl"?"KXNFLGAME-26OCT25-NY":"KXNCAAFGAME-26OCT25-NY";
 return {sport,ticker,executionEligible:false};
}
const secret="R".repeat(64);

test("central collector relays only to protected Pages, not anonymous Kalshi",async()=>{
 const ARCHIVE=archive(),now=atSport("nfl");let calls=0;
 const result=await collectKalshiPublicOnce({ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:secret},
 {now,fetchImpl:async(url,init)=>{
   calls++;
   assert.equal(new URL(url).origin,"https://fbis-myz.pages.dev");
   assert.equal(new URL(url).pathname,"/api/kalshi-collector-internal");
   assert.equal(new URL(url).searchParams.get("scope"),"markets");
   assert.equal(new URL(url).searchParams.get("sport"),"nfl");
   assert.equal(init.method,"POST");
   assert.equal(init.redirect,"manual");
   assert.equal(init.headers["x-fbis-kalshi-relay-token"],secret);
   ARCHIVE.records.set(key+"sports/nfl.json",JSON.stringify({
     ok:true,sport:"nfl",seriesTicker:"KXNFLGAME",
     capturedAt:now.toISOString(),records:[market("nfl")],paginationComplete:false,
   }));
   ARCHIVE.records.set(key+"collector-status.json",JSON.stringify({
     authenticationMode:"SIGNED_PAGES",status:"CAPTURED",attemptedAt:now.toISOString(),
   }));
   return Response.json({ok:true,status:"CAPTURED",sport:"nfl",records:1});
 }});
 assert.equal(result.ok,true);
 assert.equal(calls,1);
 const data=await loadKalshiR2Shadow({ARCHIVE},"nfl",{now:new Date(now.getTime()+1000)});
 assert.equal(data.records[0].executionEligible,false);
 assert.equal(data.records[0].canonicalEventId,null);
 assert.equal(data.governance.canQualify,false);
 assert.equal(ARCHIVE.records.size,2);
});
test("missing internal service secret blocks all collection, no public fallback",async()=>{
 const ARCHIVE=archive();let hit=0;
 const result=await collectKalshiPublicOnce({ARCHIVE},{now:atSport("nfl"),
   fetchImpl:async()=>{hit++;throw Error("SHOULD_NOT_FETCH");}});
 assert.equal(result.code,"SIGNED_RELAY_SECRET_MISSING");
 assert.equal(hit,0);
 const row=JSON.parse(ARCHIVE.records.get(key+"collector-status.json"));
 assert.equal(row.status,"CONFIGURATION_REQUIRED");
 assert.equal(row.authenticationMode,"SIGNED_RELAY_UNCONFIGURED");
});
test("Pages public reader uses only saved R2 snapshot, no Kalshi visitor fanout",async()=>{
 const ARCHIVE=archive();let touched=false;
 const response=await onRequestGet({request:new Request("https://fbis.test/api/kalshi-market-shadow?sport=nfl"),
   env:{ARCHIVE},fetchImpl:async()=>{touched=true;throw Error("NOT_FOR_VISITOR");}});
 assert.equal(touched,false);
 assert.equal(response.status,503);
 assert.equal((await response.json()).code,"KALSHI_SNAPSHOT_NOT_READY");
});
test("signed 429 cooldown blocks further relay requests; no downgrade to anonymous",async()=>{
 const ARCHIVE=archive(),now=atSport("nfl");let calls=0;
 ARCHIVE.records.set(key+"collector-status.json",JSON.stringify({
   status:"RATE_LIMITED",authenticationMode:"SIGNED_PAGES",
   blockedUntil:new Date(now.getTime()+60*60*1000).toISOString(),
 }));
 const response=await collectKalshiPublicOnce({ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:secret},
   {now,fetchImpl:async()=>{calls++;throw Error("UNEXPECTED");}});
 assert.equal(response.code,"KALSHI_SIGNED_COOLDOWN");
 assert.equal(calls,0);
});
test("signed relay reports 403 or 429 without echoing token/provider body",async()=>{
 const env={FBIS_KALSHI_RELAY_TOKEN:secret};
 for(const status of [403,429]){
   const resp=await relaySignedPages(env,{scope:"markets",sport:"nfl",
     fetchImpl:async()=>new Response("secret-upstream", {status})});
   assert.equal(resp.ok,false);
   assert.equal(resp.httpStatus,status);
   assert.ok(!JSON.stringify(resp).includes(secret));
   assert.ok(!JSON.stringify(resp).includes("secret-upstream"));
 }
 assert.equal((await relaySignedPages(env,{scope:"orders",fetchImpl:async()=>{throw Error("no");}})).code,
   "SIGNED_RELAY_SCOPE_NOT_ALLOWED");
});
test("worker has health-only route; no relay endpoint exposed",async()=>{
 const ARCHIVE=archive();
 const health=await collector.fetch(new Request("https://kalshi.test/health"),
   {ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:secret});
 assert.equal(health.status,200);
 const body=await health.json();
 assert.equal(body.relayConfigured,true);
 assert.equal(body.canAuthorizeWager,false);
 assert.ok(!JSON.stringify(body).includes(secret));
 assert.equal((await collector.fetch(new Request("https://kalshi.test/run",{method:"POST"}),{ARCHIVE})).status,404);
});
test("forged R2 rows cannot promote prices into cards",async()=>{
 const ARCHIVE=archive(),now=atSport("nfl");
 ARCHIVE.records.set(key+"sports/nfl.json",JSON.stringify({
   ok:true,sport:"nfl",seriesTicker:"KXNFLGAME",capturedAt:now.toISOString(),
   records:[{...market("nfl"),canQualify:true,canonicalEventId:"FAKE",feesDollars:0}],
 }));
 const d=await loadKalshiR2Shadow({ARCHIVE},"nfl",{now});
 assert.equal(d.records[0].canQualify,false);
 assert.equal(d.records[0].canonicalEventId,null);
 assert.equal(d.records[0].feesDollars,null);
});

test("signed Pages relay timeout surfaces as a fresh ERROR receipt without deleting saved sport snapshot",async()=>{
 const ARCHIVE=archive(),now=atSport("cfb");
 const key="kalshi/public-shadow/v1/";
 ARCHIVE.records.set(key+"sports/cfb.json",JSON.stringify({
   ok:true,sport:"cfb",seriesTicker:"KXNCAAFGAME",
   capturedAt:new Date(now.getTime()-10*60*1000).toISOString(),
   paginationComplete:false,records:[market("cfb")],
 }));
 const response=await collectKalshiPublicOnce({
   ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:secret,
 },{now,fetchImpl:async()=>{throw new DOMException("timeout","TimeoutError");}});
 assert.equal(response.ok,false);
 assert.equal(response.code,"PAGES_RELAY_UNAVAILABLE");
 const last=JSON.parse(ARCHIVE.records.get(key+"collector-status.json"));
 assert.equal(last.status,"RELAY_ERROR");
 assert.equal(last.authenticationMode,"SIGNED_PAGES");
 assert.equal(last.code,"PAGES_RELAY_UNAVAILABLE");
 assert.equal(last.sport,"cfb");
 assert.equal(last.attemptedAt,now.toISOString());
 const old=JSON.parse(ARCHIVE.records.get(key+"sports/cfb.json"));
 assert.equal(old.records.length,1);
 assert.equal(old.ok,true);
 assert.equal(last.canAuthorizeWager,false);
});

test("evidence relay transport errors create an R2 receipt without synthetic market evidence",async()=>{
 const ARCHIVE=archive(),now=atSport("cfb");
 const r=await collectKalshiEvidenceOnce({ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:secret},
  {now,fetchImpl:async()=>{throw Error("network unavailable")}});
 assert.equal(r.code,"PAGES_RELAY_UNAVAILABLE");
 const last=JSON.parse(ARCHIVE.records.get(key+"evidence-status.json"));
 assert.equal(last.status,"RELAY_ERROR");
 assert.equal(last.code,"PAGES_RELAY_UNAVAILABLE");
 assert.equal(last.canQualify,false);
 const health=await collector.fetch(new Request("https://kalshi.test/health"),{ARCHIVE});
 const body=await health.json();
 assert.equal(body.evidenceStatus,"RELAY_ERROR");
 assert.equal(body.evidenceErrorCode,"PAGES_RELAY_UNAVAILABLE");
 assert.equal(ARCHIVE.records.has(key+"evidence/nfl-latest.json"),false);
});
test("evidence relay observes 30-minute cooldown from R2 instead of sending extra HTTP calls",async()=>{
 const ARCHIVE=archive(),now=atSport("cfb");
 ARCHIVE.records.set(key+"evidence-status.json",JSON.stringify({attemptedAt:now.toISOString(),status:"BLOCKED"}));
 let calls=0;
 const r=await collectKalshiEvidenceOnce({ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:secret},
  {now:new Date(now.getTime()+1000),fetchImpl:async()=>{calls++;throw Error("unexpected")}});
 assert.equal(r.status,"NOT_DUE");assert.equal(calls,0);
});

test("auxiliary collector revisits prop series on three of every four scheduled 15-minute slots",()=>{
 const start=Date.parse("2026-10-20T00:00:00Z");
 const calls=Array.from({length:12},(_,i)=>selectedAuxScope(new Date(start+i*15*60000)));
 assert.equal(calls.filter(x=>x==="player-props").length,9);
 assert.deepEqual(calls.filter(x=>x!=="player-props"),["multilegs","combo-tape","qualification-evidence"]);
 assert.equal(selectedAuxScope(new Date(start+12*15*60000)),"player-props");
});
