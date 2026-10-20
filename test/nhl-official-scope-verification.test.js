import test from 'node:test';import assert from 'node:assert/strict';
import {verifyNhlSourceScope} from '../functions/lib/nhlOfficialScopeVerification.js';
const contract={sport:'nhl',provider:'Kalshi',identityVerified:true,historyPlayerId:'8478402',
 canonicalPlayerId:'nhl:nhl:8478402',canonicalEventId:'espn-event-1',
 contractId:'KXNHL-1',providerEventId:'KXNHL-E',providerPlayerId:'x1',
 start_time:'2026-10-20T23:00:00Z',collectedAt:'2026-10-20T12:00:00Z',
 home_abbr:'TOR',away_abbr:'EDM',team:'TOR',opponent:'EDM',
 player_name:'William Nylander',canonical_market:'shots_on_goal',period:'full_game'};
const schedule={gameWeek:[{games:[{id:2026020001,gameType:2,startTimeUTC:'2026-10-20T23:00:00Z',homeTeam:{abbrev:'TOR'},awayTeam:{abbrev:'EDM'}}]}]};
const roster={forwards:[{id:8478402,firstName:{default:'William'},lastName:{default:'Nylander'}}],defensemen:[],goalies:[]};
const check=(c=contract,s=schedule,r=roster)=>verifyNhlSourceScope(c,s,r,{observedAt:'2026-10-20T13:00:00Z'});
test('independent schedule and roster certify outcome identity but never contract settlement',()=>{
 const x=check();assert.equal(x.ok,true);assert.equal(x.scope.gameId,'2026020001');
 assert.equal(x.scope.canonicalEventId,'espn-event-1');assert.equal(x.scope.settlementRuleVerified,false);
 assert.equal(x.canAuthorizeWager,false);
});
test('wrong roster, wrong fixture, future capture and stat mismatches are rejected',()=>{
 for(const [c,s,r] of [[{...contract,canonicalPlayerId:'wrong'},schedule,roster],
 [contract,{gameWeek:[]},roster],[{...contract,collectedAt:'2026-10-21T00:00:00Z'},schedule,roster],
 [contract,schedule,{forwards:[{id:1234567,firstName:'William',lastName:'Nylander'}]}],
 [{...contract,canonical_market:'saves'},schedule,roster]]){
  assert.equal(check(c,s,r).ok,false);
 }
});
