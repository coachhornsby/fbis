import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {capturePropForecastJob} from '../functions/lib/propForecastCaptureJob.js';
const requested=new Date('2026-10-25T18:00:00Z');
const completed=new Date('2026-10-25T18:00:03Z');
async function capture({start='2026-10-25T19:00:00Z',cutoff='2026-10-25T18:00:02Z',end=completed}={}){
 const files=new Map(),g={id:'g',sport:'nhl',start,home_abbr:'BOS',away_abbr:'WPG'};
 const env={DB:{prepare:()=>({bind(){return this},first:async()=>({date:'2026-10-25'})})},ARCHIVE:{
  put:async(k,v)=>files.set(k,v),get:async k=>files.has(k)?{text:async()=>files.get(k),json:async()=>JSON.parse(files.get(k))}:null}};
 const result=await capturePropForecastJob(env,{sport:'nhl',now:requested,clock:()=>end,webCrypto:webcrypto,
  loadContextImpl:async()=>({games:[g],players:[{sport:'nhl',player_id:'1',team_key:'BOS'}],diagnostics:[]}),
  buildSlateImpl:async()=>({games:[{...g,home:{abbr:'BOS'},away:{abbr:'WPG'},
   playerProjectionStatus:{model:'NHL-PLAYER-PRO-v2',version:'research-v2.0-share-environment'},
   playerProjectionRows:[{playerId:'1',playerName:'Verified player',team:'BOS',market:'points',
    independent:true,marketInformed:false,fbisProjection:1.2,fbisSigma:.8,stateAsOf:cutoff}]}]})});
 return {result,files};
}
test('live features arriving during a request freeze at completion with original cutoff',async()=>{
 const {result,files}=await capture();
 assert.equal(result.captured,1);assert.equal(result.completedAt,completed.toISOString());
 const saved=JSON.parse(files.get(result.receipts[0].key));
 assert.equal(saved.frozenAt,completed.toISOString());
 assert.equal(saved.forecasts[0].modelAsOf,'2026-10-25T18:00:02Z');
 assert.equal(saved.recordedWager,false);assert.equal(result.canAuthorizeWager,false);
});
test('a game starting while inputs load cannot receive a pregame receipt',async()=>{
 const {result,files}=await capture({start:'2026-10-25T18:00:02.500Z'});
 assert.equal(result.captured,0);assert.equal(result.blocked.EVENT_NOT_UPCOMING,1);
 assert.equal([...files.keys()].some(k=>/g\//.test(k)),false);
});
test('future source cutoffs and a clock moving backwards stay rejected',async()=>{
 const {result}=await capture({cutoff:'2026-10-25T18:00:04Z'});
 assert.equal(result.captured,0);assert.equal(result.blocked.MODEL_INPUT_CLOCK_MISSING_OR_INVALID,1);
 assert.equal((await capture({end:new Date(+requested-1)})).result.reason,'CAPTURE_CLOCK_BEFORE_REQUEST');
});
