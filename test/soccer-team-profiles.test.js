import test from 'node:test';
import assert from 'node:assert/strict';
import { soccerTeamDirectory, summarizeSoccerTeamMatches, summarizeSoccerAdvanced } from '../functions/lib/soccerTeamProfiles.js';
import { onRequestGet } from '../functions/api/soccer-team-profiles.js';

test('owned soccer directory covers all ten routed competitions',()=>{
 const d=soccerTeamDirectory();assert.equal(d.length,10);assert.ok(d.every(c=>c.teams.length>0));
 assert.ok(d.flatMap(c=>c.teams).every(t=>t.id&&t.name&&t.logo));
});
test('team history excludes future, nonfinal, wrong-team and absent scores',()=>{
 const base={status:'FINAL',match_date:'2026-10-01',event_id:'one',home_team_id:'83',home_team_name:'Barcelona',away_team_id:'x',away_team_name:'Opponent',home_score:2,away_score:1};
 const s=summarizeSoccerTeamMatches([base,{...base,event_id:'future',match_date:'2026-11-01'},
  {...base,status:'SCHEDULED'},{...base,home_score:null},{...base,home_team_id:'other',home_team_name:'Other'}],{name:'Barcelona',espnId:'83'},'2026-10-14T05:00:00Z');
 assert.equal(s.sampleSize,1);assert.equal(s.wins,1);assert.equal(s.goalsForPerMatch,2);
 assert.equal(summarizeSoccerTeamMatches([],{name:'Barcelona',espnId:'83'},'2026-10-14').goalsForPerMatch,null);
});
test('team profile uses retained roster snapshot and keeps projection influence off',async()=>{
 let calls=0;
 const env={DB:{prepare(){return{bind(){return{all:async()=>({results:[]})}}}}},ARCHIVE:{get:async()=>({json:async()=>({observedAt:new Date().toISOString(),source:'ESPN team roster',players:[{id:'1',name:'Player'}]})})}};
 const r=await onRequestGet({env,request:new Request('https://fbis.test/api/soccer-team-profiles?league=esp.1&team=83')});
 const body=await r.json();assert.equal(body.ok,true);assert.equal(body.roster.players.length,1);assert.equal(body.persistentStateUsedInProjection,false);assert.equal(body.canAuthorize,false);
 const ambiguous=await onRequestGet({env,request:new Request('https://fbis.test/api/soccer-team-profiles?team=83')});
 assert.equal(ambiguous.status,400);
});

test('PitchAPI team metrics preserve missing values and provider identity boundaries',()=>{
 const row={status:'finished',match_date:'2026-10-01',home_team_name:'Barcelona',away_team_name:'Other',home_team_id:'pitch-bar',away_team_id:'83',home_xg:2.4,away_xg:0,home_ppda:null,away_ppda:12,source_observed_at:'2026-10-02'};
 const p=summarizeSoccerAdvanced([row,{...row,match_date:'2026-11-01'},{...row,home_team_name:'Wrong',away_team_name:'Also Wrong'}],{name:'Barcelona',espnId:'83'},'2026-10-14');
 assert.equal(p.sampleSize,1);assert.equal(p.metrics.find(m=>m.key==='xg').value,2.4);
 assert.equal(p.metrics.find(m=>m.key==='xg').opponent.value,0);
 assert.equal(p.metrics.find(m=>m.key==='ppda').value,null);
 assert.equal(p.metrics.find(m=>m.key==='ppda').sampleSize,0);
 assert.deepEqual(p.teamIds,['pitch-bar']);
});

test('big chances recover singular raw key instead of displaying legacy manufactured zero',()=>{
 const row={status:'finished',match_date:'2026-10-01',home_team_name:'Barcelona',away_team_name:'Other',home_team_id:'pitch-bar',home_big_chances:0,
  raw_stats_json:JSON.stringify({periods:[{period:'All',groups:[{items:[{key:'big_chance',home:'7',away:'0'}]}]}]})};
 const p=summarizeSoccerAdvanced([row],{name:'Barcelona'},'2026-10-14');
 assert.equal(p.metrics.find(m=>m.key==='big_chances').value,7);
 assert.equal(p.metrics.find(m=>m.key==='big_chances').opponent.value,0);
 assert.equal(p.reconciliation.storedBigChancesMismatchCount,1);
 const missing=summarizeSoccerAdvanced([{...row,raw_stats_json:null}],{name:'Barcelona'},'2026-10-14');
 assert.equal(missing.metrics.find(m=>m.key==='big_chances').value,null);
});
