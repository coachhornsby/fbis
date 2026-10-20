import test from "node:test";
import assert from "node:assert/strict";
import {kalshiIntegrationHealth,onRequestGet,onRequestPost} from "../functions/api/kalshi-integration-health.js";
import {attachKalshiSentiment} from "../functions/lib/kalshi.js";
import {auditKalshiFillReconciliation} from "../functions/lib/kalshiFillReconciliation.js";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const now=new Date("2026-10-20T08:30:00Z");
function r2(entries={}){
 return {async get(key){return entries[key]===undefined?null:{json:async()=>entries[key]};}};
}
const prefix="kalshi/public-shadow/v1/";
test("collector not started is never reported as healthy or as empty real markets",async()=>{
 const d=await kalshiIntegrationHealth({ARCHIVE:r2()},{now});
 assert.equal(d.ok,true);
 assert.equal(d.collector.state,"NOT_STARTED");
 assert.equal(d.collector.triggerVerified,false);
 assert.equal(d.sports[0].status,"NO_VERIFIED_SNAPSHOT");
 assert.equal(d.sports[0].records,null);
 assert.equal(d.stages.publicCollector,"UNVERIFIED");
 assert.equal(d.governance.canQualify,false);
 assert.equal(d.governance.canChangeCORE,false);
 assert.equal(d.governance.canSettleBets,false);
});
test("rate limit and stale feed stay explicit without quote provenance leakage",async()=>{
 const entries={
  [prefix+"collector-status.json"]:{status:"RATE_LIMITED",sport:"nfl",code:"KALSHI_PUBLIC_RATE_LIMITED",
    attemptedAt:"2026-10-20T08:15:00Z",httpStatus:429,blockedUntil:"2026-10-20T09:15:00Z"},
  [prefix+"sports/nfl.json"]:{ok:true,sport:"nfl",seriesTicker:"KXNFLGAME",
    capturedAt:"2026-10-20T06:30:00Z",records:[{ticker:"secret-person"}],paginationComplete:false},
 };
 const d=await kalshiIntegrationHealth({ARCHIVE:r2(entries)},{now});
 assert.equal(d.collector.state,"RATE_LIMITED");
 assert.equal(d.collector.upstreamHttpStatus,429);
 assert.equal(d.collector.triggerVerified,true);
 assert.equal(d.sports[0].status,"STALE_SHADOW");
 assert.equal(d.sports[0].records,null);
 assert.equal(d.stages.publicCollector,"UNVERIFIED");
 assert.equal(JSON.stringify(d).includes("secret-person"),false);
});
test("fresh research still cannot be used for wagers or book reference",async()=>{
 const entry={ok:true,sport:"cfb",seriesTicker:"KXNCAAFGAME",capturedAt:"2026-10-20T08:20:00Z",
  records:[{ticker:"KXNCAAFGAME-X"}],paginationComplete:false};
 const d=await kalshiIntegrationHealth({ARCHIVE:r2({[prefix+"sports/cfb.json"]:entry})},{now});
 assert.equal(d.sports[1].status,"FRESH_SHADOW");
 assert.equal(d.sports[1].records,1);
 assert.equal(d.sports[1].pageComplete,false);
 assert.equal(d.stages.publicCollector,"PARTIALLY_CAPTURING");
 assert.equal(d.stages.eventIdentity,"UNQUALIFIED");
 assert.equal(d.governance.canAuthorizeWager,false);
});
test("health route is read-only and never emits raw market/account data",async()=>{
 const res=await onRequestGet({env:{ARCHIVE:r2()}});
 assert.equal(res.status,200);
 assert.match(res.headers.get("cache-control"),/max-age=30/);
 assert.equal((await res.json()).governance.canQualify,false);
 assert.equal((await onRequestPost()).status,405);
 assert.match(app,/KalshiOpsStatus/);
});
test("unmatched fills require an actual FBIS journal comparison",()=>{
 const rows=[{id:"one",ticker:"KXNFLGAME-TEST"}];
 const none=auditKalshiFillReconciliation(rows);
 assert.equal(none.journalCompared,false);
 assert.equal(none.notMatchedToFbisBets,null);
 assert.equal(none.reconciledByExactFillId,null);
 assert.equal(none.journalComparisonStatus,"JOURNAL_NOT_LOADED");
 const compared=auditKalshiFillReconciliation(rows,[]);
 assert.equal(compared.journalCompared,true);
 assert.equal(compared.notMatchedToFbisBets,1);
 const exact=auditKalshiFillReconciliation(rows,[{provider:"Kalshi",exchangeFillId:"one"}]);
 assert.equal(exact.reconciledByExactFillId,1);
});
test("legacy direct market sentiment cannot make public upstream requests or fake team matches",async()=>{
 const game={id:"fixture",home:{name:"NY Giants"},away:{name:"Dallas Cowboys"}};
 const original=[game];
 const result=await attachKalshiSentiment(original,"nfl");
 assert.equal(result.games,original);
 assert.equal(result.games[0].sentiment,undefined);
 assert.equal(result.meta.enabled,false);
 assert.equal(result.meta.canQualify,false);
 assert.equal(result.meta.reason,"UNVERIFIED_EVENT_SIDE_AND_UNIT_MAPPING");
});
