import test from 'node:test';import assert from 'node:assert/strict';
import {reconcilePolymarketCoverage} from '../functions/lib/polymarketCoverage.js';
import {manageSubscriptionCapacity} from '../services/polymarket-us-stream/core.mjs';
const fixtures=[{id:'game',sport:'nfl'}],pages=[{operation:'markets',matchedEventRefs:[{eventId:'game'}],inventory:[{market:'market',eventId:'game',sport:'nfl'}],quotes:[{marketResults:[{market:'market',status:'READY'}]}]}];
test('complete coverage requires exhausted discovery, actual books and matching live subscription identities',()=>{
 const input={fixtures,pages,discoveryComplete:true,stream:{connected:true,subscribedMarketIds:['market'],uncoveredCount:0}};
 assert.equal(reconcilePolymarketCoverage(input).coverageComplete,true);
 for(const patch of [{discoveryComplete:false},{errors:[{reason:'429'}]},{stream:{connected:true,subscribedMarketIds:['other']}},{fixtures:[...fixtures,{id:'missing'}]},{pages:[{...pages[0],quotes:[]}]},{pages:[{...pages[0],operation:'page'}]}])assert.equal(reconcilePolymarketCoverage({...input,...patch}).coverageComplete,false);
});
test('full-inventory mode covers more than 500 contracts while preserving bounded subscription frames',()=>{
 const rows=Array.from({length:1201},(_,i)=>({source_market_id:'market-'+i,sport:'nfl'}));
 const result=manageSubscriptionCapacity(rows,{coverAllEligible:true,maxContracts:500,maxConnections:10});
 assert.equal(result.assignedCount,1201);assert.equal(result.uncoveredCount,0);assert.ok(result.partitions.every(p=>p.size<=50));
});

test('quote queue does not evict a quiet subscribed contract to fit a 400-contract cap',async()=>{
 const {readFileSync}=await import('node:fs');const worker=readFileSync(new URL('../services/polymarket-us-stream/worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(worker,/this\.queue\.delete\(this\.queue\.keys\(\)\.next\(\)\.value\)/);
 assert.doesNotMatch(worker,/if\(this\.queue\.size<MAX_QUEUE\)/);
});
