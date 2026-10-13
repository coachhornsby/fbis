import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,createPrivateKey,createPublicKey,verify} from "node:crypto";
import {POLY_US_ACCOUNT_READ_PATHS,signedPolymarketUsAccountGetHeaders} from "../functions/lib/polymarketUsSignedWs.js";
import {syncPolymarketUsPrivate,onRequestGet,onRequestPost} from "../functions/api/polymarket-private-sync.js";

const secret=Buffer.concat([Buffer.alloc(32,10),Buffer.alloc(32,11)]).toString("base64");
const keyId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
test("signed REST credentials strictly permit GET-only portfolio and never orders",async()=>{
 const prefix=Buffer.from("302e020100300506032b657004220420","hex");
 const pk=createPrivateKey({key:Buffer.concat([prefix,Buffer.alloc(32,10)]),format:"der",type:"pkcs8"});
 for(const path of POLY_US_ACCOUNT_READ_PATHS){
  const h=await signedPolymarketUsAccountGetHeaders({keyId,secretKey:secret,path,webCrypto:webcrypto});
  assert.ok(verify(null,Buffer.from(h["X-PM-Timestamp"]+"GET"+path),createPublicKey(pk),Buffer.from(h["X-PM-Signature"],"base64")));
  assert.ok(!JSON.stringify(h).includes(secret));
 }
 await assert.rejects(signedPolymarketUsAccountGetHeaders({keyId,secretKey:secret,path:"/v1/orders",webCrypto:webcrypto}),/not-allowed/);
});
test("private sync uses only 3 GETs, excludes bank records, saves deduped trade/position, returns aggregate-only",async()=>{
 const queries=[],bindings=[],calls=[];
 const fakeDb={prepare(sql){queries.push(sql);return{bind(...args){bindings.push(args);return{
  async run(){return{meta:{changes:1}}},
  async first(){return{n:1}}
 }}}}};
 const fetchImpl=async(url,{method,headers})=>{
  const x=new URL(url);calls.push({path:x.pathname,method,headers:Object.keys(headers)});
  const body=x.pathname.endsWith("positions")?{positions:{"buffalo-win":{netPositionDecimal:"2",cost:{value:"3.0"},realized:{value:"4.19"}}},eof:true}:
   x.pathname.endsWith("activities")?{activities:[
      {type:"ACTIVITY_TYPE_TRADE",trade:{id:"t1",marketSlug:"buffalo-win",state:"TRADE_STATE_FILLED",price:{value:"0.41"},qty:"2",costBasis:{value:"3"}}},
      {type:"ACTIVITY_TYPE_POSITION_RESOLUTION",positionResolution:{tradeId:"r1",marketSlug:"buffalo-win",side:"POSITION_RESOLUTION_SIDE_LONG",afterPosition:{realized:{value:"4.19"}}}},
      {type:"ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL",accountBalanceChange:{transactionId:"bank-secret",bankId:"sensitive"}}
   ],eof:true}:{balances:[{currency:"USD",currentBalance:12,pendingWithdrawals:[{bankId:"bank-secret"}]}]};
  return {ok:true,status:200,json:async()=>body};
 };
 const env={POLYMARKET_US_KEY_ID:keyId,POLYMARKET_US_SECRET_KEY:secret};
 const out=await syncPolymarketUsPrivate(fakeDb,env,{fetchImpl});
 assert.equal(out.ok,true);assert.equal(out.positionsCount,1);
 assert.equal(out.activityCount,2);assert.equal(out.balanceEndpointVerified,true);
 assert.equal(out.bankDetailsPersisted,false);
 assert.equal(out.automaticWagerGrading,false);
 assert.equal(out.canAuthorizeWager,false);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.method==="GET"&&!c.path.includes("/orders")));
 const joined=JSON.stringify({queries,bindings,out});
 assert.ok(!joined.includes(secret));assert.ok(!joined.includes("bank-secret"));
 assert.ok(!joined.includes("pendingWithdrawals"));
});
test("private sync auth rejects requests lacking server-side header; browser GET disabled",async()=>{
 const env={HARVEST_SECRET:"test-secret"};
 const no=await onRequestPost({request:new Request("https://test/api/polymarket-private-sync",{method:"POST"}),env});
 assert.equal(no.status,403);
 const get=await onRequestGet();assert.equal(get.status,405);
});
test("private sync fails closed for incomplete credentials or provider errors",async()=>{
 const db={prepare(){throw Error("should not query")}};
 const missing=await syncPolymarketUsPrivate(db,{});
 assert.equal(missing.ok,false);
 assert.equal(missing.reason,"credentials-not-configured");
});
