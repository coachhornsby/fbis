import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNhlInjuryReport} from '../functions/lib/nhlInjuryIntelligence.js';
import {attachNhlCardStarterEvidence} from '../functions/lib/nhlCardStarterEvidence.js';
const at='2026-10-27T18:00:00Z',start='2026-10-27T23:00:00Z',nowMs=Date.parse(at);
const row={sport:'nhl',team_key:'la',player_id:'123',player_name:'Test',position:'G',status:'OUT',source:'official',source_url:'https://www.nhl.com/',source_updated_at:at,observed_at:at,raw_json:JSON.stringify({verificationStatus:'VERIFIED'})};
test('missing and failed feeds never claim healthy',()=>{
 assert.equal(buildNhlInjuryReport([],'LA').state,'UNVERIFIED');
 assert.equal(buildNhlInjuryReport([],'LA',{storeAvailable:false}).state,'SOURCE_UNAVAILABLE');
 assert.equal(buildNhlInjuryReport([],'LA').noReportedInjuriesVerified,false);
});
test('preserves goalie position, canonical identity, original clocks and verified status',()=>{
 const r=buildNhlInjuryReport([row],'LAK',{nowMs,gameStart:start});
 assert.equal(r.players[0].position,'G');assert.equal(r.players[0].sourceUpdatedAt,at);
 assert.equal(r.players[0].canonicalPlayerId,'123');assert.equal(r.state,'REPORTED');
});
test('rejects wrong event, future clock, postgame observation, missing source clock and unverified roster inference',()=>{
 for(const patch of [{game_id:'other'},{observed_at:'2026-10-28T00:00Z'},{source_updated_at:'2026-10-27T19:00Z'},{source_updated_at:null},{raw_json:'{}'}])
  assert.equal(buildNhlInjuryReport([{...row,...patch}],'LA',{nowMs,gameId:'game',gameStart:start}).players.length,0);
});
test('freshest transition wins and old source remains stale after recent collection',()=>{
 assert.equal(buildNhlInjuryReport([row,{...row,status:'ACTIVE',observed_at:'2026-10-27T18:01Z'}],'LA',{nowMs:nowMs+60000}).players.length,0);
 assert.equal(buildNhlInjuryReport([{...row,source_updated_at:'2026-10-20T00:00Z'}],'LA',{nowMs}).state,'STALE');
});
const game={id:'board',sport:'nhl',start,home:{abbr:'LA'},away:{abbr:'ANA'}};
const profiles=()=>({teams:{la:{next_game_id:'official',next_game_start:start,next_opponent_key:'ana',next_site:'HOME',source_updated_at:at},ana:{next_game_id:'official',next_game_start:start,next_opponent_key:'la',next_site:'ROAD',source_updated_at:at}},goalies:{la:[{player_id:'123',player_name:'Test',team_key:'la',goalie_state:'CONFIRMED_STARTER',confirmation_game_id:'official',confirmation_observed_at:at,confirmation_source:'official',source_updated_at:at}]},players:{la:[]}});
test('independent detail bridges both official schedules and rejects unavailable goalie',()=>{
 const p=profiles();assert.equal(attachNhlCardStarterEvidence([game],p,nowMs).games[0].nhlStarterEvidence.home.state,'CONFIRMED');
 p.players.la=[{player_id:'123',availability_state:'OUT',source_updated_at:at}];
 const out=attachNhlCardStarterEvidence([game],p,nowMs).games[0].nhlStarterEvidence.home;
 assert.equal(out.state,'UNKNOWN');assert.equal(out.reason,'STARTER_UNAVAILABLE');assert.equal(out.expectedStartProbability,null);
});
test('hierarchy probability is not a sourced projected starter',()=>{
 const p=profiles();p.goalies.la[0]={...p.goalies.la[0],goalie_state:'EXPECTED_G1',expected_start_probability:.68};
 const out=attachNhlCardStarterEvidence([game],p,nowMs).games[0].nhlStarterEvidence.home;
 assert.equal(out.state,'UNKNOWN');assert.equal(out.reason,'NO_SOURCED_STARTER_PROJECTION');
});
