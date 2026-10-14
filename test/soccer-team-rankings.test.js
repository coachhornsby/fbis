import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSoccerDescriptiveRanks,SOCCER_DESCRIPTIVE_AGGREGATE_SQL} from '../functions/lib/soccerTeamRankings.js';
import {onRequestGet} from '../functions/api/soccer-team-rankings.js';

const observed=[
 {provider_id:'p1',provider_name:'Bayern München',games:30,wins:25,draws:3,losses:2,
  points_per_game:2.6,goals_for_per_game:3,goals_against_per_game:.6,goal_diff_per_game:2.4,
  xg_games:30,xg_for_per_game:2.5,xg_against_per_game:.8,xg_diff_per_game:1.7,
  advanced_games:20,ppda:7,field_tilt:61,progressive_passes:32,xt:1.6},
 {provider_id:'p2',provider_name:'Borussia Dortmund',games:30,wins:19,draws:6,losses:5,
  points_per_game:2.1,goals_for_per_game:2.2,goals_against_per_game:1.1,goal_diff_per_game:1.1,
  xg_games:30,xg_for_per_game:1.9,xg_against_per_game:1.1,xg_diff_per_game:.8,
  advanced_games:5,ppda:8,field_tilt:56,progressive_passes:30,xt:1.3},
];

test('German source-only descriptive rankings are scoped, sample-aware, and never model-authoritative',()=>{
 const r=buildSoccerDescriptiveRanks(observed,'ger.1');
 assert.equal(r.ok,true);assert.equal(r.canAuthorize,false);assert.equal(r.canQualify,false);assert.equal(r.canInfluenceProjection,false);
 const b=r.teams.find(t=>t.name==='Bayern Munich'),d=r.teams.find(t=>t.name==='Borussia Dortmund');
 assert.equal(b.providerTeamId,'p1');assert.equal(b.ranks.pointsPerGame.rank,1);
 assert.equal(d.ranks.pointsPerGame.rank,2);
 assert.equal(b.ranks.ppda.rank,1);
 assert.equal(d.ranks.ppda,undefined,'only five advanced-source games');
 assert.equal(b.ranks.ppda.eligibleTeams,1);
 const no=buildSoccerDescriptiveRanks(observed,'fra.1').teams;
 assert.equal(no.some(t=>t.providerTeamId==='p1'),false);
 assert.equal(buildSoccerDescriptiveRanks([],'unsupported').ok,false);
});

test('ambiguous provider identity is never silently combined',()=>{
 const rows=[observed[0],{...observed[0],provider_id:'another'}];
 const r=buildSoccerDescriptiveRanks(rows,'ger.1');
 assert.equal(r.teams.find(t=>t.name==='Bayern Munich').missingReason,'ambiguous-provider-team');
});

test('read-only rankings endpoint uses bounded league/date query and leaves model authority off',async()=>{
 let sql,args;const env={DB:{prepare(query){sql=query;return{bind(...values){args=values;return{all:async()=>({results:observed})}}}}}};
 const r=await onRequestGet({env,request:new Request('https://fbis.test/api/soccer-team-rankings?league=ger.1')});
 const d=await r.json();
 assert.equal(d.ok,true);assert.equal(d.canAuthorize,false);
 assert.match(sql,/raw_advanced_json IS NOT NULL/);
 assert.match(sql,/GROUP BY provider_id/);
 assert.equal(args[0],'ger.1');assert.equal(args[3],'ger.1');
 assert.ok(args[1]<args[2]);
 assert.match(SOCCER_DESCRIPTIVE_AGGREGATE_SQL,/status='finished'/);
 const bad=await onRequestGet({env,request:new Request('https://fbis.test/api/soccer-team-rankings?league=bad')});
 assert.equal(bad.status,400);
});
