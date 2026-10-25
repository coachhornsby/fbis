import test from 'node:test';
import assert from 'node:assert/strict';
import {readExchangeWithSportFallback} from '../scripts/lib/fbisExchangeReadFallback.mjs';
const row=(sport,id)=>({sport,id,provider:'Kalshi',identityVerified:true,
 contractId:id,marketAvailable:false,priceVerified:false});
test('healthy combined response is authoritative; no unnecessary sport reads',async()=>{
 const requests=[];
 const r=await readExchangeWithSportFallback({
  request:async p=>{requests.push(p);return {ok:true,rows:[row('nba','c1')],diagnostics:[]};},
  sports:['nba','nfl'],date:'2026-10-25'});
 assert.equal(requests.length,1);
 assert.match(requests[0],/sport=all/);
 assert.equal(r.fallbackUsed,false);
 assert.equal(r.exchange.rows.length,1);
});
test('global 503 falls back to bounded sport reads with exact source rows',async()=>{
 const requests=[];
 const result=await readExchangeWithSportFallback({
  request:async p=>{
   requests.push(p);
   if(p.includes('sport=all'))throw Error('HTTP_503');
   return {ok:true,rows:[row(p.includes('sport=nfl')?'nfl':'nba',p)],
    coverage:[],collectorCoverage:[],diagnostics:[]};
  },sports:['nba','nfl','nba'],date:'2026-10-25'});
 assert.equal(requests.length,3);
 assert.equal(result.initialFailure,'HTTP_503');
 assert.equal(result.fallbackUsed,true);
 assert.deepEqual(result.exchange.rows.map(r=>r.sport),['nba','nfl']);
 assert.deepEqual(result.failedSports,[]);
});
test('failed sport remains pipeline failure; no false empty contract coverage',async()=>{
 const r=await readExchangeWithSportFallback({
  request:async p=>{
   if(p.includes('sport=all')||p.includes('sport=nfl'))throw Error('HTTP_503');
   return {ok:true,rows:[row('nba','ok')],diagnostics:[]};
  },sports:['nba','nfl'],date:'2026-10-25'});
 assert.equal(r.exchange.ok,false);
 assert.deepEqual(r.failedSports,[{sport:'nfl',reason:'HTTP_503'}]);
 assert.deepEqual(r.exchange.rows.map(x=>x.sport),['nba']);
});
test('partial global store reads trigger fallback; scoped or degraded output is rejected',async()=>{
 const r=await readExchangeWithSportFallback({
  request:async p=>p.includes('sport=all')?
   {ok:true,rows:[row('nba','stale')],diagnostics:[{status:'READ_FAILED'}],degraded:true}:
   {ok:true,rows:[row('nfl','wrong-sport')],diagnostics:[]},
  sports:['nba'],date:'2026-10-25'});
 assert.equal(r.fallbackUsed,true);
 assert.equal(r.initialFailure,'ALL_SPORT_RESPONSE_INCOMPLETE');
 assert.equal(r.exchange.rows.length,0);
 assert.equal(r.failedSports[0].reason,'SPORT_RESPONSE_SCOPE_MISMATCH');
});
