import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStreamRosterManifest} from '../services/polymarket-us-stream/boundedSession.mjs';
const now=Date.parse('2026-11-06T23:25:00Z'),stamp=new Date(now).toISOString(),start=new Date(now+3600000).toISOString();
const row=(sport,index,half=false)=>({
 sport,canonical_event_id:sport+'-'+index,source_market_id:sport+'-'+(half?'fh':'ml')+'-'+index,
 market_family:half?'total':'moneyline',event_start_time:start,collected_at:stamp,
 ...(half?{displayBinding:{version:1,contractLong:true,period:'first_half',side:'over',line:70.5,sourceOutcomeId:'y'+index,oppositeSide:'under',oppositeSourceOutcomeId:'n'+index}}:{})
});
test('pilot returns 20 fair slots with first-half CBB totals prioritized',()=>{
 const candidates=[...Array.from({length:39},(_,i)=>row('cbb',i,false)),
 ...Array.from({length:12},(_,i)=>row('cbb',i,true)),
 ...Array.from({length:20},(_,i)=>row('nba',i,false))];
 const p=buildStreamRosterManifest(candidates,{now,maxSelected:20});
 assert.equal(p.roster.length,20);
 assert.equal(p.roster.filter(r=>r.sport==='cbb').length,10);
 assert.equal(p.roster.filter(r=>r.sport==='nba').length,10);
 assert.equal(p.roster.filter(r=>r.displayBinding?.period==='first_half').length,10);
 assert.equal(p.complete,false);assert.equal(p.canAuthorizeWager,false);
 assert.equal(buildStreamRosterManifest(candidates,{now}).roster.length,50);
 for(const cap of [0,51,1.5,NaN])assert.throws(()=>buildStreamRosterManifest(candidates,{now,maxSelected:cap}));
});
