import test from 'node:test';import assert from 'node:assert/strict';
import {createCollegeDurableAdmission}from'../scripts/lib/collegeDurableAdmission.mjs';
const NOW=Date.parse('2026-11-09T22:00:00Z'),url='https://api.collegefootballdata.com/ppa/games?year=2026';
function harness({stale=false,deny=false,remaining=500,failComplete=false,providerError=false,status=200}={}){
 const log=[],hashes=new Set();let rowid=0;
 const cloudflareFetch=async(url,options)=>{
  const {sql,params}=JSON.parse(options.body);log.push({kind:'d1',sql,params});
  if(failComplete&&sql.startsWith('UPDATE cfb_cfbd_acquisition_receipts'))return new Response('{}',{status:500});
  let results=[],changes=1;
  if(sql.includes('balance_at'))results=[{last_remaining:remaining,blocked_until_ms:0,balance_at:new Date(NOW-(stale?7:1)*3600000).toISOString(),unresolved:0}];
  if(sql.includes('INSERT OR IGNORE')){assert.ok(sql.includes('COUNT(*)'));assert.ok(sql.includes('SUM(quota_cost)'));assert.equal(params[7],45);assert.equal(params[9],1400);assert.equal(params[12],67500);const key=params[0]+params[1];changes=deny||hashes.has(key)?0:1;hashes.add(key);}
  if(sql.startsWith('INSERT INTO api_usage'))rowid++;
  return Response.json({success:true,result:[{success:true,results,meta:{changes,last_row_id:rowid,rows_read:2,rows_written:sql.startsWith('SELECT')?0:changes}}]});
 };
 const adapter=createCollegeDurableAdmission({accountId:'a'.repeat(32),databaseId:'a'.repeat(8)+'-'+('a'.repeat(4)+'-').repeat(3)+'a'.repeat(12),token:'test-token',now:NOW,cloudflareFetch,providerFetch:async()=>{log.push({kind:'provider'});if(providerError)throw Error('secret should not escape');return new Response('[]',{status,headers:{'X-CallLimit-Remaining':'499'}});}});
 return{...adapter,log};
}
test('charges and reserves before network; records outcome and remaining with unchanged caps',async()=>{
 const h=harness();await h.fetchFn(url);assert.equal(h.stats.providerAttempts,1);assert.equal(h.stats.d1Requests,6);
 const i=h.log.findIndex(r=>r.kind==='provider');assert.equal(i,3);assert.match(h.log[1].sql,/INSERT OR IGNORE/);assert.match(h.log[2].sql,/INSERT INTO api_usage/);assert.ok(h.log.some(r=>r.sql?.includes('last_remaining=?')));
});
test('same URL/day cannot be replayed even with different query ordering',async()=>{
 const h=harness();await h.fetchFn(url+'&week=10');await assert.rejects(h.fetchFn('https://api.collegefootballdata.com/ppa/games?week=10&year=2026'),/DUPLICATE_COOLDOWN_OR_BUDGET/);assert.equal(h.stats.providerAttempts,1);
});
test('unknown stale exhausted and denied admission never calls provider',async()=>{
 for(const options of [{stale:true},{remaining:100},{remaining:null},{deny:true}]){const h=harness(options);await assert.rejects(h.fetchFn(url));assert.equal(h.stats.providerAttempts,0);}
});
test('transport failures remain charged and safe errors never echo provider secrets',async()=>{
 const h=harness({providerError:true});await assert.rejects(h.fetchFn(url),/COLLEGE_PROVIDER_TRANSPORT_ERROR/);assert.equal(h.stats.providerAttempts,1);assert.ok(h.log.some(r=>r.params?.includes('transport-error')));
});
test('durable completion failure halts subsequent requests',async()=>{
 const h=harness({failComplete:true});await assert.rejects(h.fetchFn(url),/ACCOUNTING_UNAVAILABLE/);await assert.rejects(h.fetchFn(url+'&week=10'),/HALTED/);assert.equal(h.stats.providerAttempts,1);
});
test('concurrent calls serialize and retain two-call cap across providers',async()=>{
 const h=harness();const results=await Promise.allSettled([h.fetchFn(url),h.fetchFn('https://api.collegebasketballdata.com/games?season=2027'),h.fetchFn(url+'&week=10')]);assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','rejected']);assert.equal(h.stats.providerAttempts,2);assert.equal(h.stats.d1Requests,12);
});
test('429 persists cooldown without automatic retry',async()=>{
 const h=harness({status:429});assert.equal((await h.fetchFn(url)).status,429);assert.equal(h.stats.providerAttempts,1);assert.ok(h.log.some(r=>r.sql?.includes('blocked_until_ms=MAX')));
});
