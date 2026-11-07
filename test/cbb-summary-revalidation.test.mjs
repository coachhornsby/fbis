import test from 'node:test';
import assert from 'node:assert/strict';
import {startCbbSummaryRefresh,CBB_SUMMARY_RECHECK_MS,CBB_SUMMARY_MIN_READ_MS} from '../src/lib/cbbCardAuto.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(load){
 let time=0,visible=true,current=true,tick,focus,cleared=false,unlistened=false;
 const updates=[],errors=[];
 const reader=startCbbSummaryRefresh({date:'2026-11-06',load,onUpdate:r=>updates.push(r),onError:e=>errors.push(e.message),
  now:()=>time,isVisible:()=>visible,isCurrentDate:()=>current,
  setTimer:(fn,ms)=>{tick=fn;assert.equal(ms,CBB_SUMMARY_RECHECK_MS);return 1;},
  clearTimer:()=>{cleared=true;},listen:fn=>{focus=fn;return()=>{unlistened=true;};}});
 return {reader,updates,errors,tick:()=>tick(),focus:()=>focus(),advance:n=>time+=n,
  visible:v=>visible=v,current:v=>current=v,stopped:()=>cleared&&unlistened};
}
test('missing snapshot recovers on bounded recheck without page reload',async()=>{
 let calls=0;const h=harness(async()=>{if(++calls===1)throw Error('NO_CBB_SNAPSHOT');return {packet:{expiresAt:new Date(9e6).toISOString()},offers:[]};});
 await flush();assert.deepEqual(h.errors,['NO_CBB_SNAPSHOT']);
 h.advance(CBB_SUMMARY_RECHECK_MS);h.tick();await flush();
 assert.equal(calls,2);assert.equal(h.updates.length,1);h.reader.stop();
});
test('fresh snapshots skip automatic reads; manual refresh and focus are rate bounded',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {packet:{expiresAt:new Date(9e6).toISOString()}};});
 await flush();h.advance(CBB_SUMMARY_RECHECK_MS);h.tick();await flush();assert.equal(calls,1);
 await h.reader.refresh();assert.equal(calls,2);await h.reader.refresh();assert.equal(calls,2);
 h.advance(CBB_SUMMARY_MIN_READ_MS);h.visible(false);await h.reader.refresh();assert.equal(calls,2);
 h.reader.stop();assert.equal(h.stopped(),true);h.visible(true);await h.reader.refresh();assert.equal(calls,2);
});
test('expired snapshots revalidate on focus and hidden or historical views do not poll',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {packet:{expiresAt:new Date(30_000).toISOString()}};});
 await flush();h.advance(CBB_SUMMARY_MIN_READ_MS);h.visible(false);h.focus();await flush();assert.equal(calls,1);
 h.visible(true);h.current(false);h.tick();await flush();assert.equal(calls,1);
 h.current(true);h.focus();await flush();assert.equal(calls,2);h.reader.stop();
});
test('inflight reads deduplicate and stopped views ignore late responses',async()=>{
 let release,calls=0;const h=harness(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 h.advance(CBB_SUMMARY_RECHECK_MS);h.tick();await h.reader.refresh();assert.equal(calls,1);
 h.reader.stop();release({packet:{expiresAt:new Date(9e6).toISOString()}});await flush();assert.equal(h.updates.length,0);
});
