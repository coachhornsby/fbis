import test from 'node:test';import assert from 'node:assert/strict';
import {loadPinnoddsPlayerProps} from '../functions/lib/pinnoddsPlayerProps.js';
test('PinnOdds prop pairing preserves exact periods and lines, decimal units and provider-only player identity',async()=>{
 const rows=[['full_game',5.5,'over',1.8],['full_game',5.5,'under',2.1],['num_1',5.5,'over',1.9],['full_game',6.5,'under',1.6]].map(([period,line,side,decimal_odds],i)=>({sport:'mlb',canonical_event_id:'game',provider_event_id:'special',source_market_id:'market-'+i,source_outcome_id:'side-'+i,player_name:'Pitcher',stat_family:'strikeouts',period,line,side,decimal_odds,source_observed_at:null,collected_at:'2026-10-13T17:00:00Z',raw_payload_json:JSON.stringify({eventMatchStatus:'TWO_TEAM_KICKOFF_VERIFIED',original:{market:{type:'total',key:'k'}}})}));
 const db={prepare(){return{bind(){return{async all(){return{results:rows}}}}}}};
 const result=await loadPinnoddsPlayerProps(db,['game'],'mlb');assert.equal(result.length,3);const paired=result.find(r=>r.period==='full_game'&&r.line===5.5);assert.equal(paired.overDecimalOdds,1.8);assert.equal(paired.underDecimalOdds,2.1);assert.equal(paired.overOdds,null);assert.equal(paired.fbisPlayerId,null);assert.equal(paired.fbisProjection,null);assert.equal(paired.canAuthorizeWager,false);
});
