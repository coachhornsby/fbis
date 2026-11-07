import test from 'node:test';
import assert from 'node:assert/strict';
import {relaySignedPages} from '../services/kalshi-public-collector/index.js';
const env={FBIS_KALSHI_RELAY_TOKEN:'x'.repeat(64)};
const run=response=>relaySignedPages(env,{scope:'markets',sport:'nfl',fetchImpl:async()=>response});
test('relay preserves expected cooldown and budget stop without retry or claiming capture',async()=>{
 for(const code of ['KALSHI_SIGNED_POLL_NOT_DUE','KALSHI_SIGNED_COOLDOWN','ACCOUNT_BUDGET_STOP','BOUNDED_COLLECTION_STOPPED']){
  let calls=0;
  const result=await relaySignedPages(env,{scope:'markets',sport:'nfl',fetchImpl:async()=>{calls++;return Response.json({ok:false,code},{status:503});}});
  assert.deepEqual(result,{ok:false,code,httpStatus:503});assert.equal(calls,1);
 }
});
test('relay never reflects arbitrary bodies or secret-like strings',async()=>{
 for(const body of [JSON.stringify({ok:false,code:'PRIVATE_SECRET_VALUE'}),'<html>error secret</html>',JSON.stringify({ok:true,code:'ACCOUNT_BUDGET_STOP'}),JSON.stringify({ok:false,code:'ACCOUNT_BUDGET_STOP',padding:'x'.repeat(4096)})]){
  const result=await run(new Response(body,{status:503}));assert.equal(result.code,'PAGES_RELAY_HTTP_ERROR');assert.equal(result.httpStatus,503);
 }
});
test('auth denial and rate limit retain precedence',async()=>{
 for(const [status,code] of [[403,'PAGES_RELAY_DENIED'],[429,'KALSHI_SIGNED_RATE_LIMITED'],[500,'PAGES_RELAY_HTTP_ERROR']])assert.deepEqual(await run(Response.json({ok:false,code:'ACCOUNT_BUDGET_STOP'},{status})),{ok:false,code,httpStatus:status});
});
