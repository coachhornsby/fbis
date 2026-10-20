import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {
  runKalshiConnectivityDiagnostic,diagnoseConnectivityStatuses,
} from "../functions/lib/kalshiConnectivityDiagnostic.js";
import {onRequestPost,onRequestGet} from "../functions/api/kalshi-connectivity-diagnostic.js";
import {readFileSync} from "node:fs";
const at=new Date("2026-10-20T13:00:00.000Z");
function vault(){
 const values=new Map();
 return {values,async get(k){return values.has(k)?{json:async()=>JSON.parse(values.get(k))}:null;},
   async put(k,v){values.set(k,String(v));}};
}
async function env(){
 const kp=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const der=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",kp.privateKey));
 return {ARCHIVE:vault(),FBIS_ACCOUNT_VIEW_TOKEN:"view-code-123",
   KALSHI_API_KEY_ID:"example-id",KALSHI_PRIVATE_KEY_PEM1:
     "-----BEGIN PRIVATE KEY-----\n"+der.toString("base64")+"\n-----END PRIVATE KEY-----"};
}
test("operator sends precisely one signed GET, never anonymous",async()=>{
 const e=await env();let calls=0;
 const result=await runKalshiConnectivityDiagnostic(e,{
  sport:"nfl",now:at,webCrypto:webcrypto,fetchImpl:async(url,options)=>{
   calls++;
   const u=new URL(url);
   assert.equal(u.origin,"https://external-api.kalshi.com");
   assert.equal(u.pathname,"/trade-api/v2/markets");
   assert.equal(u.searchParams.get("series_ticker"),"KXNFLGAME");
   assert.equal(u.searchParams.get("limit"),"1");
   assert.equal(options.method,"GET");
   assert.equal(options.redirect,"manual");
   assert.equal(options.headers["KALSHI-ACCESS-KEY"],e.KALSHI_API_KEY_ID);
   assert.ok(options.headers["KALSHI-ACCESS-SIGNATURE"]);
   return new Response("",{status:200});
  },
 });
 assert.equal(result.ok,true);
 assert.equal(result.guest.result,"DISABLED_BY_POLICY");
 assert.equal(result.guest.httpStatus,null);
 assert.equal(result.signed.httpStatus,200);
 assert.equal(result.diagnosis,"SIGNED_MARKET_ACCESS_VERIFIED");
 assert.equal(result.canQualify,false);
 assert.equal(calls,1);
 assert.equal(e.ARCHIVE.values.size,1);
 const receipts=[...e.ARCHIVE.values.values()].join(" ");
 assert.ok(!receipts.includes(e.KALSHI_PRIVATE_KEY_PEM1));
 assert.ok(!receipts.includes(e.KALSHI_API_KEY_ID));
});
test("old cached anonymous HTTP 429 is suppressed without another upstream call",async()=>{
 const e=await env();
 e.ARCHIVE.values.set("kalshi/public-shadow/v1/connectivity-diagnostics/global.json",JSON.stringify({
  checkedAt:at.toISOString(),nextAllowedAt:new Date(at.getTime()+15*60*1000).toISOString(),
  testedSport:"nfl",guest:{httpStatus:429,result:"RATE_LIMITED"},
  signed:{httpStatus:200,result:"HTTP_OK"},
  diagnosis:"ANONYMOUS_RATE_LIMIT_AUTHENTICATED_ACCEPTED",
 }));
 const r=await runKalshiConnectivityDiagnostic(e,{
  sport:"cfb",now:new Date(at.getTime()+5*60*1000),webCrypto:webcrypto,
  fetchImpl:async()=>{throw Error("MUST_NOT_FETCH");},
 });
 assert.equal(r.cached,true);
 assert.equal(r.guest.result,"DISABLED_BY_POLICY");
 assert.equal(r.diagnosis,"SIGNED_MARKET_ACCESS_VERIFIED");
 assert.equal(r.testedSport,"nfl");
});
test("global 15m cooldown guards signed calls",async()=>{
 const e=await env();let calls=0;
 await runKalshiConnectivityDiagnostic(e,{sport:"cfb",now:at,webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;return new Response("",{status:200});}});
 const r=await runKalshiConnectivityDiagnostic(e,{
  sport:"nfl",now:new Date(at.getTime()+5*60*1000),webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;throw Error("NO_EXTRA");},
 });
 assert.equal(r.cached,true);
 assert.equal(r.testedSport,"cfb");
 assert.equal(r.guest.result,"DISABLED_BY_POLICY");
 assert.equal(calls,1);
});
test("missing store, invalid sport and missing signing credentials fail closed",async()=>{
 const e=await env();let calls=0;
 const unexpected=async()=>{calls++;throw Error("NO");};
 assert.equal((await runKalshiConnectivityDiagnostic({...e,ARCHIVE:null},{
   now:at,webCrypto:webcrypto,fetchImpl:unexpected})).code,"DIAGNOSTIC_RATE_LIMIT_STORE_MISSING");
 assert.equal((await runKalshiConnectivityDiagnostic(e,{
   sport:"golf",now:at,webCrypto:webcrypto,fetchImpl:unexpected})).code,"SPORT_NOT_ALLOWED");
 assert.equal((await runKalshiConnectivityDiagnostic({...e,KALSHI_API_KEY_ID:null},{
   now:at,webCrypto:webcrypto,fetchImpl:unexpected})).code,"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED");
 assert.equal(calls,0);
});
test("operator route rejects invalid private access code without signing",async()=>{
 const e=await env(),url="https://fbis.test/api/kalshi-connectivity-diagnostic?sport=nfl";
 let calls=0;
 for(const token of [null,"incorrect"]){
   const response=await onRequestPost({request:new Request(url,{
     method:"POST",headers:token?{"x-fbis-account-token":token}:{},
   }),env:e,webCrypto:webcrypto,fetchImpl:async()=>{calls++;throw Error("NO");}});
   assert.equal(response.status,403);
   assert.equal((await response.json()).code,"PORTFOLIO_ACCESS_DENIED");
 }
 assert.equal(calls,0);
 assert.equal((await onRequestGet()).status,405);
});
test("signed HTTP 429 correctly identified without reverting to anonymous",async()=>{
 const e=await env();let calls=0;
 const response=await onRequestPost({
  request:new Request("https://fbis.test/api/kalshi-connectivity-diagnostic?sport=nfl",{
   method:"POST",headers:{"x-fbis-account-token":e.FBIS_ACCOUNT_VIEW_TOKEN},
  }),env:e,webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;return new Response("secret-upstream",{status:429});},
 });
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.diagnosis,"SIGNED_RATE_LIMITED");
 assert.equal(body.guest.httpStatus,null);
 assert.equal(body.signed.httpStatus,429);
 assert.equal(calls,1);
 assert.ok(!JSON.stringify(body).includes("secret-upstream"));
 assert.equal(diagnoseConnectivityStatuses(null,{httpStatus:401}),"SIGNED_AUTHENTICATION_OR_PERMISSION_REJECTED");
});
test("signed transport and redirects return safe codes, never upstream details",async()=>{
 const e=await env();let calls=0;
 const result=await runKalshiConnectivityDiagnostic(e,{sport:"nfl",now:at,webCrypto:webcrypto,
  fetchImpl:async(_url,opts)=>{
   calls++;assert.equal(opts.redirect,"manual");
   throw new TypeError("SECRET MUST NOT LEAK");
  }});
 assert.equal(calls,1);
 assert.equal(result.diagnosis,"SIGNED_TRANSPORT_UNAVAILABLE");
 assert.equal(result.signed.failureKind,"FETCH_TYPE_ERROR");
 assert.ok(!JSON.stringify(result).includes("SECRET"));
 const e2=await env();
 const redirect=await runKalshiConnectivityDiagnostic(e2,{sport:"nfl",now:at,webCrypto:webcrypto,
  fetchImpl:async()=>new Response(null,{status:301,headers:{location:"https://malicious.example"}})});
 assert.equal(redirect.diagnosis,"SIGNED_REDIRECT_REJECTED");
 assert.ok(!JSON.stringify(redirect).includes("malicious.example"));
});
test("System UI does not persist private diagnostic access code",()=>{
 const content=readFileSync(new URL("../src/features/dataHealth/KalshiOpsStatus.jsx",import.meta.url),"utf8");
 assert.match(content,/type="password"/);
 assert.match(content,/x-fbis-account-token/);
 assert.ok(content.includes('setAccessCode("")'));
 assert.doesNotMatch(content,/localStorage|sessionStorage/);
});
