import test from 'node:test';
import assert from 'node:assert/strict';
import {filterPinnoddsToFbisProjections} from '../functions/lib/pinnoddsProjectionScope.js';

const capturedAt='2026-10-16T15:00:00.000Z';
const eventStart='2026-10-16T23:00:00.000Z';
function db({snapshots=[],published=[],tennis=[]}={}){
 const calls=[];
 return {
  calls,
  prepare(sql){
   return {bind(...args){
    calls.push({sql,args});
    return {async all(){
     const sport=args[0],idSet=new Set(args.slice(1,-1).map(String));
     const dataset=/FROM prediction_snapshots/.test(sql)?snapshots:
       /FROM published_projections/.test(sql)?published:tennis;
     return {results:dataset.filter(r=>r.sport===sport&&idSet.has(String(r.event_id))).map(r=>({
       event_id:r.event_id,model_at:r.model_at
     }))};
    }};
   }};
  }
 };
}
const offer=(id,marketFamily='moneyline',sport='cfb',start=eventStart)=>({
 source:'PinnOdds',sport,marketFamily,eventId:id,eventStart:start,
 raw:{providerEventId:id+'-provider'}
});
test('free whole-board normalizer selects only games with pre-capture models',async()=>{
 const mock=db({snapshots:[{sport:'cfb',event_id:'modeled',model_at:'2026-10-15T10:00:00Z'}]});
 const input=[offer('modeled'),offer('other'),offer('modeled','spread'),offer('modeled','total'),offer('modeled','player_prop')];
 const out=await filterPinnoddsToFbisProjections(mock,input,{capturedAt});
 assert.equal(out.inputRows,5);
 assert.equal(out.rows.length,3);
 assert.equal(out.projectedEventCount,1);
 assert.equal(out.rejectedNoCanonicalOrModel,2);
 assert.equal(out.omittedNonGameMarkets,1);
 assert.equal(out.canAuthorizeWager,false);
 assert.equal(out.modelClockPolicy,'PRE_CAPTURE_AND_PRE_START');
});
test('late forecasts cannot retrospectively qualify a captured quote',async()=>{
 const mock=db({snapshots:[{sport:'cfb',event_id:'future',model_at:'2026-10-16T17:00:00Z'}]});
 const out=await filterPinnoddsToFbisProjections(mock,[offer('future')],{capturedAt});
 assert.equal(out.rows.length,0);
});
test('a model created after kickoff cannot authorize earlier bookmaker research',async()=>{
 const mock=db({snapshots:[{sport:'cfb',event_id:'late',model_at:'2026-10-16T13:00:00Z'}]});
 const out=await filterPinnoddsToFbisProjections(mock,[offer('late','moneyline','cfb','2026-10-16T12:00:00Z')],{capturedAt});
 assert.equal(out.rows.length,0);
});
test('fail closed when model provenance cannot be queried',async()=>{
 await assert.rejects(filterPinnoddsToFbisProjections({},[offer('x')],{capturedAt}),/DB_OR_CLOCK/);
 const bad=db();bad.prepare=()=>({bind(){return {all:async()=>{throw Error('NO_MODEL_TABLE');}};}});
 await assert.rejects(filterPinnoddsToFbisProjections(bad,[offer('x')],{capturedAt}),/NO_MODEL_TABLE/);
});
