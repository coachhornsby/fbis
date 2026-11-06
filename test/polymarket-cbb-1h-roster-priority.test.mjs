import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStreamRosterManifest} from '../services/polymarket-us-stream/boundedSession.mjs';
test('CBB 1H totals are admitted before moneylines without changing 50-market cross-sport limit',()=>{
 const now=Date.parse('2026-11-06T23:00:00Z');
 const at=new Date(now).toISOString(),start=new Date(now+3600000).toISOString();
 const make=(sport,index)=>({sport,canonical_event_id:sport+'-'+index,
  source_market_id:sport+'-ml-'+index,market_family:'moneyline',event_start_time:start,collected_at:at});
 const rows=[...Array.from({length:40},(_,i)=>make('cbb',i)),
  ...Array.from({length:40},(_,i)=>make('nfl',i)),
  {sport:'cbb',canonical_event_id:'cbb-1h',source_market_id:'cbb-1h-tot-70',
   market_family:'total',event_start_time:start,collected_at:at,
   displayBinding:{version:1,contractLong:true,period:'first_half',side:'over',line:70.5,
    sourceOutcomeId:'yes',oppositeSide:'under',oppositeSourceOutcomeId:'no'}}
 ];
 const result=buildStreamRosterManifest(rows,{now});
 assert.equal(result.roster.length,50);
 assert.equal(result.coverage.cbb.selected,25);
 assert.equal(result.coverage.nfl.selected,25);
 assert.equal(result.complete,false);
 assert.equal(result.roster.some(x=>x.source_market_id==='cbb-1h-tot-70'),true);
 assert.equal(result.canAuthorizeWager,false);
});
