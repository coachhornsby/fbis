import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { captureKalshiSportsSeriesCatalog } from "../functions/lib/kalshiSignedCollector.js";
import { collectKalshiSeriesCatalogOnce } from "../services/kalshi-public-collector/index.js";
import { onRequestPost } from "../functions/api/kalshi-collector-internal.js";
import { kalshiIntegrationHealth } from "../functions/api/kalshi-integration-health.js";

const NOW=new Date("2026-10-20T14:00:00.000Z"),PREFIX="kalshi/public-shadow/v1/";
function bucket(){
 const rows=new Map();
 return {rows,async get(k){return rows.has(k)?{json:async()=>JSON.parse(rows.get(k))}:null;},
   async put(k,v){rows.set(k,String(v));}};
}
async function pagesEnv(){
 const kp=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const der=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",kp.privateKey));
 return {ARCHIVE:bucket(),KALSHI_API_KEY_ID:"test-id",
  KALSHI_PRIVATE_KEY_PEM1:"-----BEGIN PRIVATE KEY-----\n"+der.toString("base64")+"\n-----END PRIVATE KEY-----",
  FBIS_KALSHI_RELAY_TOKEN:"z".repeat(64)};
}
test("signed daily Sports-series catalog uses one GET and never promotes research series",async()=>{
 const env=await pagesEnv();let calls=0;
 const result=await captureKalshiSportsSeriesCatalog(env,{now:NOW,webCrypto:webcrypto,
  fetchImpl:async(url,opts)=>{
   calls++;
   const u=new URL(url);
   assert.equal(u.pathname,"/trade-api/v2/series");
   assert.equal(u.searchParams.get("category"),"Sports");
   assert.equal(opts.method,"GET");
   assert.ok(opts.headers["KALSHI-ACCESS-SIGNATURE"]);
   return Response.json({series:[
    {ticker:"KXNFLGAME",title:"NFL game winners",category:"Sports",tags:["Football"]},
    {ticker:"KXNBAGAME",title:"NBA game winners",category:"Sports",tags:["Basketball"]},
    {ticker:"bad injected key? nope",title:"Unsafe"},
   ]});
  }});
 assert.equal(result.ok,true);
 assert.equal(calls,1);
 assert.equal(result.reportedSeries,3);
 assert.equal(result.storedSeries,2);
 const data=JSON.parse(env.ARCHIVE.rows.get(PREFIX+"series-catalog.json"));
 assert.equal(data.categoryFilter,"Sports");
 assert.equal(data.records.length,2);
 assert.equal(data.records[0].canQualify,false);
 assert.equal(data.records[1].executionEligible,false);
 assert.ok(!JSON.stringify(data).includes(env.KALSHI_PRIVATE_KEY_PEM1));
 const health=await kalshiIntegrationHealth(env,{now:NOW});
 assert.equal(health.seriesCatalog.storedSeriesCount,2);
 assert.equal(health.seriesCatalog.scope,"DISCOVERY_NOT_VALIDATED_CONTRACT_COVERAGE");
 assert.equal(health.governance.canQualify,false);
 const cached=await captureKalshiSportsSeriesCatalog(env,{
  now:new Date(NOW.getTime()+60*60*1000),webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;throw Error("NO_EXTRA_DISCOVERY");},
 });
 assert.equal(cached.code,"KALSHI_CATALOG_POLL_NOT_DUE");
 assert.equal(calls,1);
});
test("catalog rate limits fail closed, retain last good snapshot and back off",async()=>{
 const env=await pagesEnv();
 env.ARCHIVE.rows.set(PREFIX+"series-catalog.json",JSON.stringify({
  ok:true,records:[{ticker:"KXNFLGAME"}],storedSeries:1,reportedSeries:1,
 }));
 let calls=0;
 const result=await captureKalshiSportsSeriesCatalog(env,{now:NOW,webCrypto:webcrypto,
   fetchImpl:async()=>{
    calls++;return new Response("no raw upstream details",{status:429});
   }});
 assert.equal(result.ok,false);
 assert.equal(result.code,"KALSHI_CATALOG_RATE_LIMITED");
 const saved=JSON.parse(env.ARCHIVE.rows.get(PREFIX+"series-catalog-status.json"));
 assert.equal(saved.status,"RATE_LIMITED");
 assert.ok(Date.parse(saved.nextAllowedAt)-NOW.getTime()>=6*60*60*1000);
 assert.equal(JSON.parse(env.ARCHIVE.rows.get(PREFIX+"series-catalog.json")).storedSeries,1);
 assert.equal(calls,1);
});
test("worker catalog discovery requests Pages only when daily R2 guard allows",async()=>{
 const ARCHIVE=bucket(),env={ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:"T".repeat(64)};
 let calls=0;
 const first=await collectKalshiSeriesCatalogOnce(env,{now:NOW,fetchImpl:async(url,opts)=>{
  calls++;assert.equal(new URL(url).hostname,"fbis-myz.pages.dev");
  assert.equal(new URL(url).searchParams.get("scope"),"series-catalog");
  assert.equal(opts.method,"POST");
  return Response.json({ok:true,storedSeries:3});
 }});
 assert.equal(first.ok,true);
 assert.equal(calls,1);
 ARCHIVE.rows.set(PREFIX+"series-catalog-status.json",JSON.stringify({
  status:"DISCOVERED",nextAllowedAt:new Date(NOW.getTime()+24*60*60*1000).toISOString(),
 }));
 const skip=await collectKalshiSeriesCatalogOnce(env,{
  now:new Date(NOW.getTime()+20*60*60*1000),
  fetchImpl:async()=>{calls++;throw Error("UNEXPECTED");},
 });
 assert.equal(skip.code,"KALSHI_CATALOG_POLL_NOT_DUE");
 assert.equal(calls,1);
});
test("internal catalog route denies unknown token and accepts scoped signed request",async()=>{
 const env=await pagesEnv(),url="https://fbis.test/api/kalshi-collector-internal?scope=series-catalog";
 const denied=await onRequestPost({request:new Request(url,{method:"POST"}),env,webCrypto:webcrypto});
 assert.equal(denied.status,403);
 let calls=0;
 const good=await onRequestPost({
  request:new Request(url,{method:"POST",headers:{"x-fbis-kalshi-relay-token":env.FBIS_KALSHI_RELAY_TOKEN}}),
  env,webCrypto:webcrypto,fetchImpl:async()=>{
   calls++;return Response.json({series:[{ticker:"KXSOCCER",title:"Soccer"}]});
  },
 });
 assert.equal(good.status,200);
 assert.equal(calls,1);
 assert.equal((await good.json()).storedSeries,1);
});
