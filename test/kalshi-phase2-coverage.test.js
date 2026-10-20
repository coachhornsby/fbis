import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {getKalshiShadowMarketsPage} from "../functions/lib/kalshiMarketShadow.js";
import {captureSignedKalshiMarkets} from "../functions/lib/kalshiSignedCollector.js";
import {auditKalshiMarketRecords,kalshiCoverageReport} from "../functions/lib/kalshiCoverageAudit.js";
import {onRequestGet,onRequestPost} from "../functions/api/kalshi-coverage-report.js";
import {verifyKalshiEventIdentity} from "../functions/lib/kalshiContractIdentity.js";
import {readFileSync} from "node:fs";
const begin=new Date("2026-10-20T12:00:00Z"),BASE="kalshi/public-shadow/v1/";
function store(){
 const items=new Map();
 return{items,async get(k){return items.has(k)?{json:async()=>JSON.parse(items.get(k))}:null;},
  async put(k,v){items.set(k,String(v));}};
}
async function env(){
 const kp=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const der=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",kp.privateKey));
 return {ARCHIVE:store(),KALSHI_API_KEY_ID:"test-key",
  KALSHI_PRIVATE_KEY_PEM1:"-----BEGIN PRIVATE KEY-----\n"+der.toString("base64")+"\n-----END PRIVATE KEY-----"};
}
function m(ticker="KXNCAAFGAME-26OCT25-DAL",title="Dallas Cowboys wins"){
 return {ticker,event_ticker:"KXNCAAFGAME-26OCT25",
  title,yes_sub_title:"Dallas Cowboys",
  yes_bid_dollars:"0.48",yes_ask_dollars:"0.51",
  rules_primary:"Wins under official rules",status:"active"};
}
test("small signed CFB pages checkpoint and resume without overwriting live snapshot",async()=>{
 const e=await env();let calls=0;
 const first=await captureSignedKalshiMarkets(e,{sport:"cfb",now:begin,
  webCrypto:webcrypto,fetchImpl:async(url,opts)=>{
   calls++;
   assert.equal(opts.method,"GET");
   assert.equal(opts.redirect,"manual");
   assert.ok(opts.headers["KALSHI-ACCESS-SIGNATURE"]);
   assert.equal(new URL(url).searchParams.get("limit"),"250");
   assert.equal(new URL(url).searchParams.get("cursor"),null);
   return Response.json({markets:[m()],cursor:"NEXT"});
  }});
 assert.equal(first.ok,true);assert.equal(first.status,"PAGINATING");
 assert.equal(first.records,1);assert.equal(first.pagesFetched,1);
 assert.equal(e.ARCHIVE.items.has(BASE+"sports/cfb.json"),false);
 const progress=JSON.parse(e.ARCHIVE.items.get(BASE+"sports/cfb-progress.json"));
 assert.equal(progress.cursor,"NEXT");
 assert.equal(progress.records.length,1);
 const second=await captureSignedKalshiMarkets(e,{sport:"cfb",
   now:new Date(begin.getTime()+31*60*1000),webCrypto:webcrypto,
   fetchImpl:async(url)=>{
    calls++;assert.equal(new URL(url).searchParams.get("cursor"),"NEXT");
    return Response.json({markets:[m("KXNCAAFGAME-26OCT25-NYG","New York Giants wins")],cursor:""});
   }});
 assert.equal(second.status,"CAPTURED");
 assert.equal(second.records,2);
 assert.equal(second.pagesFetched,2);
 assert.equal(calls,2);
 const snap=JSON.parse(e.ARCHIVE.items.get(BASE+"sports/cfb.json"));
 assert.equal(snap.paginationComplete,true);
 assert.equal(snap.records.length,2);
 assert.equal(snap.records[0].fetchedAt,begin.toISOString());
 assert.equal(snap.records[1].fetchedAt,new Date(begin.getTime()+31*60000).toISOString());
 assert.equal(snap.governance.canQualify,false);
 const receipt=JSON.parse(e.ARCHIVE.items.get(BASE+"sports/cfb-status.json"));
 assert.equal(receipt.status,"CAPTURED");
 const cleared=JSON.parse(e.ARCHIVE.items.get(BASE+"sports/cfb-progress.json"));
 assert.equal(cleared.cursor,"");
});
test("partial 429 preserves cursor and previous published snapshot with one-hour cooldown",async()=>{
 const e=await env();let calls=0;
 e.ARCHIVE.items.set(BASE+"sports/cfb.json",JSON.stringify({
  ok:true,sport:"cfb",seriesTicker:"KXNCAAFGAME",
  capturedAt:new Date(begin.getTime()-5*60000).toISOString(),
  records:[{sport:"cfb",ticker:m().ticker,fetchedAt:begin.toISOString()}],
  paginationComplete:true,
 }));
 await captureSignedKalshiMarkets(e,{sport:"cfb",now:begin,webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;return Response.json({markets:[m()],cursor:"NEXT"});}});
 const fail=await captureSignedKalshiMarkets(e,{sport:"cfb",
  now:new Date(begin.getTime()+31*60000),webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;return new Response("",{status:429});}});
 assert.equal(fail.ok,false);assert.equal(fail.status,"RATE_LIMITED");
 assert.equal(calls,2);
 assert.equal(fail.pagesFetched,1);
 assert.equal(JSON.parse(e.ARCHIVE.items.get(BASE+"sports/cfb-progress.json")).cursor,"NEXT");
 assert.equal(JSON.parse(e.ARCHIVE.items.get(BASE+"sports/cfb.json")).paginationComplete,true);
 const blocked=await captureSignedKalshiMarkets(e,{sport:"cfb",
  now:new Date(begin.getTime()+40*60000),webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;throw Error("NEVER_CALL");}});
 assert.equal(blocked.code,"KALSHI_SIGNED_COOLDOWN");
 assert.equal(calls,2);
});
test("provider malformed cursor and different series fail closed",async()=>{
 const r=await getKalshiShadowMarketsPage("cfb",{
  cursor:"a".repeat(2100),fetchImpl:async()=>{throw Error("NO");}});
 assert.equal(r.code,"KALSHI_PUBLIC_CURSOR_INVALID");
 const err=await getKalshiShadowMarketsPage("cfb",{
  now:begin,fetchImpl:async()=>Response.json({markets:[m()],cursor:5})});
 assert.equal(err.code,"KALSHI_PUBLIC_CURSOR_INVALID");
 const other=await getKalshiShadowMarketsPage("soccer",{
  fetchImpl:async()=>{throw Error("NO");}});
 assert.equal(other.code,"KALSHI_SERIES_NOT_QUALIFIED");
});
test("event identity requires immutable canonical id and near-exact independent kickoff",()=>{
 const fixture={id:"fixture-42",home_name:"New York Giants",away_name:"Dallas Cowboys",
  startTime:"2026-10-25T17:00:00Z"};
 const event={event_ticker:m().event_ticker,title:"Dallas Cowboys at New York Giants",
  verifiedGameStartTime:fixture.startTime};
 const market={event_ticker:event.event_ticker};
 assert.equal(verifyKalshiEventIdentity({fixture,event,market}).matched,true);
 assert.equal(verifyKalshiEventIdentity({fixture:{...fixture,id:""},event,market}).matched,false);
 assert.equal(verifyKalshiEventIdentity({fixture,event:{...event,
  verifiedGameStartTime:"2026-10-25T17:35:00Z"},market}).reason,"KICKOFF_MISMATCH");
 assert.equal(verifyKalshiEventIdentity({fixture,event,market:{event_ticker:"OTHER"}}).matched,false);
});
test("explicit evidence can validate event identity, never side or execution",()=>{
 const row={...m(),sport:"cfb",eventTicker:m().event_ticker,
  ticker:m().ticker,title:m().title,rulesPrimary:"Wins under official rules",
  fetchedAt:begin.toISOString()};
 const fixture={id:"fixture-42",home_name:"New York Giants",away_name:"Dallas Cowboys",
  startTime:begin.toISOString()};
 const event={event_ticker:row.eventTicker,title:"Dallas Cowboys at New York Giants",
  verifiedGameStartTime:begin.toISOString()};
 const x=auditKalshiMarketRecords("cfb",[row],{now:begin,evidence:[{fixture,event}]});
 assert.equal(x.independentFixtureCandidates,1);
 assert.equal(x.sample[0].canonicalEventId,"fixture-42");
 assert.equal(x.verifiedExecutableMarkets,0);
 assert.equal(x.fullyQualifiedMarkets,0);
 assert.equal(x.sample[0].canQualify,false);
 assert.ok(x.sample[0].reasons.includes("FEE_SCHEDULE_NOT_VERIFIED"));
 const ambiguous=auditKalshiMarketRecords("cfb",[row],
  {now:begin,evidence:[{fixture,event},{fixture,event}]});
 assert.equal(ambiguous.independentFixtureCandidates,0);
});
test("unmatched rows have actionable blocker counts and no fake moneyline odds",()=>{
 const rows=[{...m(),sport:"cfb",eventTicker:m().event_ticker,
  rulesPrimary:"Wins under official rules",fetchedAt:begin.toISOString()},
  {...m("KXNCAAFGAME-26OCT25-NYG","New York Giants wins"),
   sport:"cfb",eventTicker:m().event_ticker,
   rulesPrimary:"Wins under official rules",fetchedAt:begin.toISOString()}];
 const r=auditKalshiMarketRecords("cfb",rows,{now:begin});
 assert.equal(r.recordsReviewed,2);
 assert.equal(r.uniqueEvents,1);
 assert.equal(r.twoOutcomeCandidates,1);
 assert.equal(r.independentFixtureCandidates,0);
 assert.equal(r.reasons.INDEPENDENT_FIXTURE_AND_EVENT_EVIDENCE_MISSING,2);
 assert.equal(r.reasons.QUOTE_SOURCE_TIME_NOT_VERIFIED,2);
 assert.equal(r.fullyQualifiedMarkets,0);
 assert.equal(r.canPublishMarketOdds,false);
 const aged=auditKalshiMarketRecords("cfb",rows,{
  now:new Date(begin.getTime()+70*60000),
 });
 assert.equal(aged.quoteAgeStaleRows,2);
});
test("R2-only report lists partial cursor alongside previous stale snapshot without promoting it",async()=>{
 const e={ARCHIVE:store()};
 e.ARCHIVE.items.set(BASE+"sports/cfb-progress.json",JSON.stringify({
  version:1,sport:"cfb",cursor:"NEXT",pagesFetched:2,records:[m()],
 }));
 e.ARCHIVE.items.set(BASE+"sports/cfb-status.json",JSON.stringify({
  status:"PAGINATING",attemptedAt:begin.toISOString(),
 }));
 e.ARCHIVE.items.set(BASE+"sports/cfb.json",JSON.stringify({
  ok:true,sport:"cfb",seriesTicker:"KXNCAAFGAME",
  paginationComplete:true,capturedAt:new Date(begin.getTime()-70*60000).toISOString(),
  records:[{sport:"cfb",ticker:m().ticker,eventTicker:m().event_ticker,
   title:m().title,fetchedAt:new Date(begin.getTime()-70*60000).toISOString()}],
 }));
 const rep=await kalshiCoverageReport(e,{now:begin});
 const row=rep.sports.find(x=>x.sport==="cfb");
 assert.equal(row.snapshotStatus,"STALE");
 assert.equal(row.recordsInProgress,1);
 assert.equal(row.pagesInProgress,2);
 assert.equal(row.continuationPending,true);
 assert.equal(row.completeCurrentQuoteCoverage,false);
 assert.equal(row.lastAttemptState,"PAGINATING");
 assert.equal(rep.governance.canChangeCORE,false);
 const res=await onRequestGet({
  request:new Request("https://fbis.test/api/kalshi-coverage-report?sport=cfb"),env:e,
 });
 assert.equal(res.status,200);
 assert.equal((await res.json()).sports.length,1);
 const invalid=await onRequestGet({request:new Request(
  "https://fbis.test/api/kalshi-coverage-report?sport=soccer"),env:e});
 assert.equal(invalid.status,400);
 assert.equal((await onRequestPost()).status,405);
});
test("System UI exposes market coverage with no order or wager actions",()=>{
 const src=readFileSync(new URL("../src/features/dataHealth/KalshiCoverageAudit.jsx",import.meta.url),"utf8");
 const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
 assert.match(app,/KalshiCoverageAudit/);
 assert.match(src,/api\/kalshi-coverage-report/);
 assert.doesNotMatch(src,/placeOrder|setBet|authorizeWager|setProjection/);
});
