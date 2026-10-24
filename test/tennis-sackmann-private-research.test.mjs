import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePrivateSackmannResearch} from '../functions/lib/tennisSackmannPrivateResearch.js';
const row={tourney_id:'2026-123',match_num:'1',tourney_date:'20261010',surface:'Hard',
 winner_id:'123',loser_id:'456',w_svpt:'60',w_1stIn:'35',w_1stWon:'25',w_2ndWon:'12',
 l_svpt:'70',l_1stIn:'40',l_1stWon:'26',l_2ndWon:'10'};
test('private research aggregation tracks attribution, point in time and excluded trading authority',()=>{
 const o=summarizePrivateSackmannResearch([row,row,{...row,tourney_date:'20261025',match_num:'2'}],
  {tour:'atp',asOf:'2026-10-23'});
 assert.equal(o.accepted,1);assert.equal(o.playerSurfaces.length,2);
 assert.equal(o.playerSurfaces.find(x=>x.playerId==='123').firstServePointsWon,25/35);
 assert.equal(o.privateResearchOnly,true);assert.equal(o.forContractTrading,false);
 assert.equal(o.commercialUseAuthorized,false);assert.equal(o.canAuthorizeWager,false);
});
test('invalid cutoff and unknown sources cannot be silently accepted',()=>{
 assert.throws(()=>summarizePrivateSackmannResearch([],{tour:'atp'}));
 const out=summarizePrivateSackmannResearch([{...row,winner_id:'ABC'}, {...row,surface:'Unknown'}],
  {tour:'wta',asOf:'2026-10-23'});
 assert.equal(out.accepted,0);
});
