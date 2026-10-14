import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pinnoddsWindow,pinnoddsWindowComplete} from '../scripts/lib/pinnoddsSchedule.mjs';

const at=s=>new Date(s);
const status=(w,{skip=null,old=false,unreconciled=false}={})=>{
 const created=old?'2026-10-13T10:00:00.000Z':new Date(Date.parse(w.windowStart)+10*60000).toISOString();
 const scopes=w.scope==='full'?Array.from({length:6},(_,i)=>['prematch','live'].map(feed=>({kind:'board',sportId:i+1,feed}))).flat():['prematch','live'].map(feed=>({kind:'drops',feed}));
 return {ok:true,results:scopes.filter((_,i)=>i!==skip).map(s=>({...s,status:'RECENT_CAPTURE',collectedAt:created,reconciled:!unreconciled}))};
};
test('primary and fallback share one full six-hour slot key',()=>{
 const a=pinnoddsWindow(at('2026-10-14T00:23:00Z'));
 const b=pinnoddsWindow(at('2026-10-14T01:23:00Z'));
 assert.deepEqual(a,b);assert.equal(a.scope,'full');assert.match(a.runId,/pinnodds-20261014-00-full/);
});
test('drop primary/backup reuse the same durable reservation',()=>{
 const a=pinnoddsWindow(at('2026-10-14T03:23:00Z'));
 assert.deepEqual(a,pinnoddsWindow(at('2026-10-14T04:23:00Z')));
 assert.equal(a.scope,'drops');assert.notEqual(a.runId,pinnoddsWindow(at('2026-10-14T06:23:00Z')).runId);
});
test('window changes at midnight and never creates a second ID inside same slot',()=>{
 assert.notEqual(pinnoddsWindow(at('2026-10-14T23:59:00Z')).runId,pinnoddsWindow(at('2026-10-15T00:01:00Z')).runId);
 assert.throws(()=>pinnoddsWindow('invalid'),/INVALID_SCHEDULE_TIME/);
});
test('skip only when every full-board scope is reconciled in the same due window',()=>{
 const w=pinnoddsWindow(at('2026-10-14T00:23:00Z')),now=at('2026-10-14T01:23:00Z');
 assert.equal(pinnoddsWindowComplete(status(w),w,now),true);
 assert.equal(pinnoddsWindowComplete(status(w,{skip:0}),w,now),false);
 assert.equal(pinnoddsWindowComplete(status(w,{old:true}),w,now),false);
 assert.equal(pinnoddsWindowComplete(status(w,{unreconciled:true}),w,now),false);
});
test('status unavailable blocks paid launches before provider reservation',()=>{
 const w=pinnoddsWindow(at('2026-10-14T03:23:00Z'));
 assert.throws(()=>pinnoddsWindowComplete({ok:false},w),/PINNODDS_STATUS_REQUIRED/);
 assert.equal(pinnoddsWindowComplete(status(w),w,at('2026-10-14T04:23:00Z')),true);
});
test('paid PinnOdds workflow excludes pushes and defaults manual captures off',()=>{
 const wf=readFileSync(new URL('../.github/workflows/pinnodds-governed-capture.yml',import.meta.url),'utf8');
 assert.match(wf,/23 1,4,7,10,13,16,19,22/);
 assert.match(wf,/paid_capture:/);
 assert.match(wf,/default: false/);
 assert.match(wf,/if: github.event_name == 'schedule' \|\|/);
 assert.doesNotMatch(wf,/if: github.event_name != 'pull_request'/);
 const script=readFileSync(new URL('../scripts/collect-pinnodds-governed.mjs',import.meta.url),'utf8');
 assert.match(script,/pinnoddsWindowComplete\(status,window\)/);
 assert.match(script,/const \{scope,runId\}=window/);
});
