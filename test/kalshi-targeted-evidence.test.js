import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {captureKalshiTargetedEvidence} from "../functions/lib/kalshiTargetedEvidence.js";
const root="kalshi/public-shadow/v1/";
const now=new Date("2026-10-20T15:00:00Z");
function store(){const m=new Map();return{m,async get(k){return m.has(k)?{json:async()=>JSON.parse(m.get(k))}:null},async put(k,v){m.set(k,String(v))}}}
async function setup(){
 const keys=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const pem=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",keys.privateKey)).toString("base64");
 return {ARCHIVE:store(),KALSHI_API_KEY_ID:"test",KALSHI_PRIVATE_KEY_PEM1:"-----BEGIN PRIVATE KEY-----\n"+pem+"\n-----END PRIVATE KEY-----"};
}
const ticker="KXNFLGAME-26NOV02CHISEA-SEA",eventTicker="KXNFLGAME-26NOV02CHISEA";
test("requires a completed trusted-series snapshot and makes zero provider calls otherwise",async()=>{
 const env=await setup();let calls=0;
 const r=await captureKalshiTargetedEvidence(env,{now,webCrypto:webcrypto,fetchImpl:async()=>{calls++;throw Error("NO")}});
 assert.equal(r.code,"COMPLETE_SNAPSHOT_REQUIRED");assert.equal(calls,0);
});
test("signed event and orderbook produce R2 evidence without authority or private fields",async()=>{
 const env=await setup();
 env.ARCHIVE.m.set(root+"sports/nfl.json",JSON.stringify({ok:true,paginationComplete:true,seriesTicker:"KXNFLGAME",records:[{ticker,eventTicker}]}));
 let calls=0;
 const fetchImpl=async(url,init)=>{
  calls++;assert.equal(init.method,"GET");assert.equal(init.redirect,"manual");
  assert.equal(new URL(url).origin,"https://external-api.kalshi.com");
  assert.ok(init.headers["KALSHI-ACCESS-SIGNATURE"]);
  if(url.includes("/events/"))return Response.json({event:{event_ticker:eventTicker,title:"Chicago at Seattle"}});
  return Response.json({orderbook_fp:{yes_dollars:[["0.4","5"]],no_dollars:[["0.42","7"]]}});
 };
 const r=await captureKalshiTargetedEvidence(env,{now,webCrypto:webcrypto,fetchImpl});
 assert.equal(r.status,"EVIDENCE_COLLECTED");assert.equal(calls,2);
 const saved=JSON.parse(env.ARCHIVE.m.get(root+"evidence/nfl-latest.json"));
 assert.equal(saved.orderbook.yesAskDollars,0.58);
 assert.equal(saved.orderbook.yesAskSizeContracts,7);
 assert.equal(saved.independentFixtureVerified,false);
 assert.equal(saved.executionEligible,false);
 assert.equal(saved.exchangeQuoteTimestamp,null);
 const repeat=await captureKalshiTargetedEvidence(env,{now:new Date(now.getTime()+1000),webCrypto:webcrypto,fetchImpl});
 assert.equal(repeat.status,"NOT_DUE");assert.equal(calls,2);
});
test("wrong event and provider 429 fail closed before orderbook",async()=>{
 const env=await setup();
 env.ARCHIVE.m.set(root+"sports/nfl.json",JSON.stringify({ok:true,paginationComplete:true,seriesTicker:"KXNFLGAME",records:[{ticker,eventTicker}]}));
 let calls=0;
 const bad=await captureKalshiTargetedEvidence(env,{now,webCrypto:webcrypto,fetchImpl:async()=>{calls++;return Response.json({event:{event_ticker:"WRONG"}})}});
 assert.equal(bad.code,"EVENT_IDENTITY_MISMATCH");assert.equal(calls,1);
 assert.equal(env.ARCHIVE.m.has(root+"evidence/nfl-latest.json"),false);
});
