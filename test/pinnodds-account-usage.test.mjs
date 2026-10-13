import test from 'node:test';import assert from 'node:assert/strict';
import {readPinnoddsAccountUsage} from '../workers/pinnodds-account-usage.mjs';
test('account capability read calls only non-chargeable usage and never exposes provider key',async()=>{
 const methods=[];const result=await readPinnoddsAccountUsage({apiKey:'test-private-key',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://mcp.pinnodds.com/mcp');assert.equal(options.headers.authorization,'Bearer test-private-key');const body=JSON.parse(options.body);methods.push(body.method);
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='initialize'?{protocolVersion:'2025-03-26'}:{structuredContent:{plan:'pro',limits:{daily:100},usedToday:8,api_key:'test-private-key',email:'private@example.test',message:'test-private-key'}}}));
 }});
 assert.deepEqual(methods,['initialize','notifications/initialized','tools/call']);assert.equal(result.chargeableOddsRequests,0);assert.equal(result.usage.plan,'pro');assert.doesNotMatch(JSON.stringify(result),/test-private-key|private@example/);
});
test('provider account errors fail closed before odds calls',async()=>{await assert.rejects(readPinnoddsAccountUsage({apiKey:'key',fetchImpl:async()=>new Response('',{status:403})}),/ACCOUNT_HTTP_403/);});
