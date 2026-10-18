import test from 'node:test';
import assert from 'node:assert/strict';
import {attachPrizePicksMarkets} from '../functions/lib/todayBoard.js';
import {canonicalizeProPlayerPropMarket} from '../functions/lib/proPlayerProps.js';
test('football specialty stats cannot inherit a full-game probability or projection',()=>{
 for(const sport of ['nfl','cfb']){
  for(const label of ['Quarters with 25+ Pass Yards','Longest Pass Yards','First Half Passing Yards'])assert.equal(canonicalizeProPlayerPropMarket(sport,label),null);
  assert.equal(canonicalizeProPlayerPropMarket(sport,'Pass Yards'),'passing_yards');
  assert.equal(canonicalizeProPlayerPropMarket(sport,'core_bet_type_9_passing_yards'),'passing_yards');
 }
});
test('current NFL cards include Sunday-night lines and exclude the next game day',async()=>{
 const games=[{id:'123',away:{abbr:'DAL'},home:{abbr:'GB'},start:'2026-10-19T00:20:00Z'}];
 const row={fbis_event_id:'123',team:'DAL',player_name:'Player',stat_type:'Pass Yards',canonical_market:'passing_yards',line:230,odds_tier:'standard',duration:'full'};
 const db={prepare(sql){assert.match(sql,/state='COMPLETE'/);return {bind(){return {all:async()=>({results:[{...row,start_time:'2026-10-19T00:20:00Z'},{...row,start_time:'2026-10-20T00:20:00Z',line:240}]})}}}}};
 const result=await attachPrizePicksMarkets(games,'nfl','2026-10-18',db);
 assert.equal(result[0].playerMarkets.length,1);
 assert.equal(result[0].playerMarkets[0].line,230);
 assert.equal(result[0].playerMarkets[0].decisionEligible,false);
});
