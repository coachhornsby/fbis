import test from 'node:test';
import assert from 'node:assert/strict';
import {repairWindow,planFbisRepairs,chooseArchivedSnapshots,executeFbisRepairs} from '../scripts/lib/fbisVerifiedRecovery.mjs';
const time=Date.parse('2026-10-25T00:07:00Z');
const issues=[{code:'PROP_PROJECTION_MISSING',sport:'nba'},{code:'PROP_PROJECTION_MISSING',sport:'tennis'},
 {code:'GAME_CURRENT_MARKET_UNVERIFIED',sport:'tennis'},{code:'PROP_CURRENT_ODDS_UNVERIFIED',sport:'nba'}];
test('automatic recovery has bounded windows; never repairs on every poll/push',()=>{
 assert.equal(repairWindow({now:time,event:'schedule'}),true);
 assert.equal(repairWindow({now:time+31*60000,event:'schedule'}),false);
 assert.equal(repairWindow({now:time,event:'push'}),false);
 assert.equal(repairWindow({now:time,event:'workflow_dispatch'}),true);
});
test('repair plan limits itself to approved capture and zero-cost rematch',()=>{
 const p=planFbisRepairs(issues,{now:time});
 assert.deepEqual(p.forecasts,['nba']);
 assert.deepEqual(p.archiveSports,['tennis']);
 assert.ok(p.blocked.includes('NO_APPROVED_PROP_CAPTURE:tennis'));
});
test('archive rematch requires a preexisting fresh zero-match source receipt',()=>{
 const rows=[{kind:'board',sportId:2,feed:'prematch',snapshotId:'safe-1',normalizedRows:30,matchedRows:0,collectedAt:new Date(time-3600000).toISOString()},
 {...{kind:'board',sportId:2,feed:'prematch',snapshotId:'safe-2',normalizedRows:10,matchedRows:8,collectedAt:new Date(time-3600000).toISOString()}},
 {kind:'board',sportId:2,feed:'prematch',snapshotId:'safe-3',normalizedRows:30,matchedRows:0,collectedAt:new Date(time-49*3600000).toISOString()}];
 assert.deepEqual(chooseArchivedSnapshots({ok:true,results:rows},['tennis'],{now:time}).map(r=>r.snapshotId),['safe-1']);
});
test('archive recovery independently selects one latest eligible receipt for each of two sports',()=>{
 const row=(sportId,snapshotId,minutes)=>({
  kind:'board',feed:'prematch',sportId,snapshotId,normalizedRows:15,matchedRows:0,
  reconciled:true,collectedAt:new Date(time-minutes*60000).toISOString()
 });
 const candidates=[row(3,'nba-old',40),row(2,'tennis-new',30),row(3,'nba-new',10),
  row(2,'tennis-old',120),row(5,'other-sport',5)];
 const selected=chooseArchivedSnapshots({ok:true,results:candidates},['nba','tennis'],{now:time});
 assert.deepEqual(selected.map(r=>r.snapshotId),['nba-new','tennis-new']);
 assert.equal(selected.length,2);
});
test('repair runner posts approved forecast once and rematches archived receipts, never provider capture',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts={})=>{
  calls.push({url,method:opts.method,body:opts.body?JSON.parse(opts.body):null});
  const response=url.includes('/api/pinnodds-status')?{ok:true,results:[{
   kind:'board',sportId:2,feed:'prematch',snapshotId:'safe-1',
   normalizedRows:20,matchedRows:0,collectedAt:new Date(time-300000).toISOString()}]}:
   url.includes('/api/prop-acceptance')?{ok:true,captured:4,candidateProjections:4,status:'CAPTURED'}:
   opts.body?.includes('"prepare"')?{ok:true,batches:1}:
   opts.body?.includes('"consume"')?{ok:true,inserted:4}:{ok:true,matchedRows:4};
  return {ok:true,json:async()=>response,status:200};
 };
 const r=await executeFbisRepairs({incidents:issues,date:'2026-10-24',now:time,event:'schedule',secret:'test-secret',fetchImpl});
 assert.equal(r.attempted,2);
 assert.equal(r.paidProviderCalls,0);
 assert.equal(r.marketOverrides,0);
 assert.equal(r.modelOverrides,0);
 assert.equal(r.receipts[0].status,'RECORDED_AWAITING_READBACK');
 assert.equal(r.receipts[1].status,'REMATCHED_AWAITING_CARD_RECHECK');
 assert.equal(calls.filter(x=>x.url.includes('/api/prop-acceptance')).length,1);
 assert.equal(calls.filter(x=>x.url.includes('/api/pinnodds-ingest')).length,3);
 assert.ok(calls.every(x=>!x.url.includes('/api/pinnodds-capture')));
});
test('no secret, no authorized writes; market quote unverifiable is not repairable',async()=>{
 let called=0;
 const r=await executeFbisRepairs({incidents:[{code:'PROP_CURRENT_ODDS_UNVERIFIED',sport:'nba'}],now:time,event:'schedule',secret:'',
  fetchImpl:async()=>{called++;throw Error('not allowed')}});
 assert.equal(r.attempted,0);assert.equal(called,0);
});
