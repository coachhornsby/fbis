import test from 'node:test';
import assert from 'node:assert/strict';
import {readExchangeObservationPage} from '../functions/lib/exchangePropPagination.js';

const settings={start:'2026-10-25T05:00:00Z',end:'2026-10-26T05:00:00Z',sports:['nfl']};
function makeStore(total){
 const rows=Array.from({length:total},(_,i)=>({
   id:'obs-'+String(total-i).padStart(6,'0'),
   collected_at:new Date(Date.parse('2026-10-25T23:00:00Z')-i*1000).toISOString(),
   sport:'nfl',market_family:'player_prop'
 }));
 let reads=0;
 const store={
  binding:'Q4B',
  db:{
   prepare(sql){
    assert.ok(sql.includes('ORDER BY collected_at DESC,id DESC LIMIT 500'));
    return {
     bind(...params){
      return {
       async all(){
        reads++;
        const n=params.length;
        const after=n>3?{collected_at:params[n-3],id:params[n-1]}:null;
        const remaining=after?rows.filter(r=>r.collected_at<after.collected_at ||
           (r.collected_at===after.collected_at&&r.id<after.id)):rows;
        return {results:remaining.slice(0,500)};
       }
      };
     }
    };
   }
  }
 };
 return {store,get reads(){return reads;}};
}
test('read beyond 5000 without truncation or re-reading last key',async()=>{
 const source=makeStore(5507),seen=new Set();
 let cursor=null,rounds=0;
 do{
  const p=await readExchangeObservationPage([source.store],{...settings,cursor,pageBudget:3});
  for(const r of p.rows){assert.equal(seen.has(r.id),false);seen.add(r.id);}
  cursor=p.nextCursor;rounds++;
  assert.ok(rounds<10);
  if(cursor){assert.equal(p.readComplete,false);assert.equal(p.moreAvailable,true);}
  else{assert.equal(p.readComplete,true);assert.equal(p.moreAvailable,false);}
 }while(cursor);
 assert.equal(seen.size,5507);
 assert.equal(source.reads,12);
});
test('store cursors are scoped to sport, date and binding set',async()=>{
 const source=makeStore(600);
 const p=await readExchangeObservationPage([source.store],{...settings,pageBudget:1});
 assert.ok(p.nextCursor);
 await assert.rejects(readExchangeObservationPage([source.store],{...settings,sports:['nba'],cursor:p.nextCursor}),/SCOPE_MISMATCH/);
 await assert.rejects(readExchangeObservationPage([source.store],{...settings,cursor:'abc&invalid'}),/INVALID_MARKET_READ_CURSOR/);
 await assert.rejects(readExchangeObservationPage([source.store],{...settings,pageBudget:11}),/INVALID_MARKET_READ_SCOPE/);
});
test('independent store failures never become verified complete coverage',async()=>{
 const source=makeStore(3);
 const broken={binding:'BROKEN',db:{prepare(){throw Error('DB_UNAVAILABLE');}}};
 const p=await readExchangeObservationPage([source.store,broken],{...settings,pageBudget:1});
 assert.equal(p.rows.length,3);
 assert.equal(p.degraded,true);
 assert.equal(p.readComplete,false);
 assert.equal(p.diagnostics[1].status,'READ_FAILED');
 assert.equal(p.nextCursor,null);
});
