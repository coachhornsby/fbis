import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNhlOfficialResultsOnce} from '../services/kalshi-public-collector/index.js';
test('NHL shadow polling does not call Pages without independently certified scope',async()=>{
 const memory=new Map();const env={ARCHIVE:{get:async k=>memory.has(k)?{json:async()=>JSON.parse(memory.get(k))}:null}};
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({ok:true})}};
 assert.equal((await collectNhlOfficialResultsOnce(env,{fetchImpl})).status,'NOT_CONFIGURED');
 memory.set('player-props/official/v1/nhl-scopes.json',JSON.stringify({version:1,certified:false,scopes:[{}]}));
 assert.equal((await collectNhlOfficialResultsOnce(env,{fetchImpl})).status,'NOT_CONFIGURED');assert.equal(calls,0);
});
test('certified NHL scope uses existing authenticated relay and respects hourly receipt',async()=>{
 const memory=new Map();
 memory.set('player-props/official/v1/nhl-scopes.json',JSON.stringify({version:1,certified:true,scopes:[{gameId:'2025020001'}]}));
 const env={FBIS_KALSHI_RELAY_TOKEN:'a'.repeat(40),ARCHIVE:{get:async k=>memory.has(k)?{json:async()=>JSON.parse(memory.get(k))}:null}};
 let calls=0;const fetchImpl=async (url,request)=>{calls++;assert.match(url,/scope=nhl-official-prop-results/);assert.equal(request.method,'POST');return {ok:true,json:async()=>({ok:true,status:'CAPTURED'})}};
 const now=new Date('2026-10-21T03:00:00Z');const result=await collectNhlOfficialResultsOnce(env,{now,fetchImpl});
 assert.equal(result.ok,true);assert.equal(calls,1);
 memory.set('player-props/official/v1/nhl-last-receipt.json',JSON.stringify({checkedAt:'2026-10-21T02:50:00Z'}));
 assert.equal((await collectNhlOfficialResultsOnce(env,{now,fetchImpl})).status,'NOT_DUE');assert.equal(calls,1);
});
