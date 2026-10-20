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
 return {
  values,
  async get(key){return values.has(key)?{json:async()=>JSON.parse(values.get(key))}:null;},
  async put(key,content){values.set(key,String(content));},
 };
}
async function env(){
 const pair=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const der=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",pair.privateKey));
 return {ARCHIVE:vault(),FBIS_ACCOUNT_VIEW_TOKEN:"view-code-123",
   KALSHI_API_KEY_ID:"example-credential",
   KALSHI_PRIVATE_KEY_PEM1:"-----BEGIN PRIVATE KEY-----\n"+der.toString("base64")+"\n-----END PRIVATE KEY-----"};
}
test("fixed GET-only market-path signing uses same key but keeps read-only portfolio allowlist",async()=>{
 const e=await env(),calls=[];
 const fetchImpl=async(url,options)=>{
   calls.push({url,method:options.method,hasSignature:!!options.headers["KALSHI-ACCESS-SIGNATURE"],
     key:options.headers["KALSHI-ACCESS-KEY"]});
   assert.equal(options.method,"GET");
   const uri=new URL(url);
   assert.equal(uri.origin,"https://external-api.kalshi.com");
   assert.equal(uri.pathname,"/trade-api/v2/markets");
   assert.equal(uri.searchParams.get("series_ticker"),"KXNFLGAME");
   assert.equal(uri.searchParams.get("limit"),"1");
   return new Response("",{status:calls.length===1?429:200});
 };
 const result=await runKalshiConnectivityDiagnostic(e,{sport:"nfl",now:at,fetchImpl,webCrypto:webcrypto});
 assert.equal(result.ok,true);
 assert.equal(result.cached,false);
 assert.equal(result.diagnosis,"ANONYMOUS_RATE_LIMIT_AUTHENTICATED_ACCEPTED");
 assert.equal(result.guest.httpStatus,429);
 assert.equal(result.signed.httpStatus,200);
 assert.equal(calls.length,2);
 assert.equal(calls[0].hasSignature,false);
 assert.equal(calls[1].hasSignature,true);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(result.canQualify,false);
 assert.ok(!JSON.stringify(result).includes(e.KALSHI_PRIVATE_KEY_PEM1));
 assert.ok(!JSON.stringify(result).includes(e.KALSHI_API_KEY_ID));
 assert.equal(e.ARCHIVE.values.size,1);
 const serialized=[...e.ARCHIVE.values.values()].join(" ");
 assert.ok(!serialized.includes(e.KALSHI_PRIVATE_KEY_PEM1));
 assert.ok(!serialized.includes(e.KALSHI_API_KEY_ID));
});

test("operator diagnostics are globally cached for 15 minutes; no second upstream request",async()=>{
 const e=await env();let requests=0;
 const fetchImpl=async()=>{requests++;return Response.json({markets:[]});};
 await runKalshiConnectivityDiagnostic(e,{sport:"cfb",now:at,fetchImpl,webCrypto:webcrypto});
 const cached=await runKalshiConnectivityDiagnostic(e,{
   sport:"nfl",now:new Date(at.getTime()+5*60*1000),
   fetchImpl:async()=>{throw Error("MUST_NOT_FETCH_SECOND_TIME");},
   webCrypto:webcrypto,
 });
 assert.equal(requests,2);
 assert.equal(cached.ok,true);
 assert.equal(cached.cached,true);
 assert.equal(cached.testedSport,"cfb");
 assert.equal(cached.canQualify,false);
 assert.equal(cached.nextAllowedAt,new Date(at.getTime()+15*60*1000).toISOString());
});

test("no R2 rate-limit store, signing credentials or allowed sport fails without request",async()=>{
 const e=await env();let called=false;
 const fetchImpl=async()=>{called=true;throw Error("unexpected");};
 assert.equal((await runKalshiConnectivityDiagnostic({...e,ARCHIVE:null},{
   now:at,fetchImpl,webCrypto:webcrypto})).code,"DIAGNOSTIC_RATE_LIMIT_STORE_MISSING");
 assert.equal((await runKalshiConnectivityDiagnostic(e,{
   sport:"soccer",now:at,fetchImpl,webCrypto:webcrypto})).code,"SPORT_NOT_ALLOWED");
 assert.equal((await runKalshiConnectivityDiagnostic({...e,KALSHI_API_KEY_ID:null},{
   now:at,fetchImpl,webCrypto:webcrypto})).code,"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED");
 assert.equal(called,false);
});

test("private route denies missing or wrong code before signing or network activity",async()=>{
 const e=await env();let requests=0;
 const fetchImpl=async()=>{requests++;throw Error("MUST_NOT_RUN");};
 const url="https://fbis.test/api/kalshi-connectivity-diagnostic?sport=nfl";
 const missing=await onRequestPost({request:new Request(url,{method:"POST"}),env:e,
   fetchImpl,webCrypto:webcrypto});
 assert.equal(missing.status,403);
 assert.equal((await missing.json()).code,"PORTFOLIO_ACCESS_DENIED");
 const wrong=await onRequestPost({
   request:new Request(url,{method:"POST",headers:{"x-fbis-account-token":"wrong"}}),
   env:e,fetchImpl,webCrypto:webcrypto,
 });
 assert.equal(wrong.status,403);
 assert.equal(requests,0);
 assert.match(wrong.headers.get("cache-control"),/no-store/);
 assert.equal((await onRequestGet()).status,405);
});

test("authorized route returns only safe HTTP statuses and 429 distinctions",async()=>{
 const e=await env();
 const request=new Request("https://fbis.test/api/kalshi-connectivity-diagnostic?sport=nfl",{
   method:"POST",headers:{"x-fbis-account-token":e.FBIS_ACCOUNT_VIEW_TOKEN},
 });
 let hits=0;
 const response=await onRequestPost({request,env:e,webCrypto:webcrypto,
   fetchImpl:async()=>{hits++;return new Response("secret-upstream-text",{status:hits===1?403:429});}});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.diagnosis,"INCONCLUSIVE");
 assert.equal(body.guest.httpStatus,403);
 assert.equal(body.signed.httpStatus,429);
 assert.equal(hits,2);
 assert.ok(!JSON.stringify(body).includes("secret-upstream-text"));
 assert.equal(diagnoseConnectivityStatuses({httpStatus:429},{httpStatus:429}),"BOTH_RATE_LIMITED");
 assert.equal(diagnoseConnectivityStatuses({result:"HTTP_OK"},{result:"HTTP_OK"}),"BOTH_ACCEPTED");
 assert.equal(diagnoseConnectivityStatuses({httpStatus:429},{httpStatus:401}),
   "SIGNED_AUTHENTICATION_OR_PERMISSION_REJECTED");
});

test("System UI includes secured one-time button; no persisted browser secrets",()=>{
 const code=readFileSync(new URL("../src/features/dataHealth/KalshiOpsStatus.jsx",import.meta.url),"utf8");
 assert.match(code,/Test Kalshi connectivity now/);
 assert.match(code,/type="password"/);
 assert.match(code,/x-fbis-account-token/);
 assert.match(code,/method:"POST"/);
 assert.match(code,/setAccessCode\("?"\)/);
 assert.doesNotMatch(code,/localStorage|sessionStorage/);
});
