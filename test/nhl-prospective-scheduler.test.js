import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNhlProspectiveOnce} from '../services/kalshi-public-collector/index.js';
test('protected NHL prospective snapshot relay observes receipt cadence',async()=>{
 const memory=new Map();
 const env={FBIS_KALSHI_RELAY_TOKEN:'p'.repeat(40),
  ARCHIVE:{get:async k=>memory.has(k)?{json:async()=>JSON.parse(memory.get(k))}:null}};
 let calls=0;const fetchImpl=async(url,opt)=>{calls++;assert.match(url,/scope=nhl-prospective-capture/);
  assert.equal(opt.method,'POST');return {ok:true,json:async()=>({ok:true,status:'CAPTURED'})}};
 const now=new Date('2026-10-20T12:00:00Z');
 assert.equal((await collectNhlProspectiveOnce(env,{now,fetchImpl})).ok,true);assert.equal(calls,1);
 memory.set('player-props/evidence/v1/last-capture-receipt.json',JSON.stringify({attemptedAt:'2026-10-20T11:30:00Z'}));
 assert.equal((await collectNhlProspectiveOnce(env,{now,fetchImpl})).status,'NOT_DUE');assert.equal(calls,1);
});
