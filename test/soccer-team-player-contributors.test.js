import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSoccerPitchApiPlayerContributors} from '../functions/lib/soccerTeamPlayerContributors.js';

test('PitchAPI club contributor query scopes IDs to provider team, league and cutoff',async()=>{
 let sql,args;
 const r={player_id:'p_1',team_id:'t_1',player_name:'Sample Player',match_count:8,minutes_played:599,
  goals:3,assists:1,xt_total:1.23,vaep_total:2.1,xag:0.5,progressive_passes:35,latest_match:'2026-10-10'};
 const env={DB:{prepare(q){sql=q;return{bind(...p){args=p;return{all:async()=>({results:[r]})}}}}}};
 const d=await loadSoccerPitchApiPlayerContributors(env,{league:'ger.1',teamIds:['t_1','t_1'],
   startDate:'2026-01-01',asOf:'2026-10-14',limit:40});
 assert.equal(d.players.length,1);
 assert.deepEqual(args,['ger.1','2026-01-01','2026-10-14','t_1',40]);
 assert.match(sql,/group by player_id,team_id/i);
 assert.match(sql,/match_date<\?/);
 assert.match(sql,/limit \?/i);
 assert.equal(d.players[0].id,'soccer:pitchapi:p_1');
 assert.equal(d.players[0].goals,3);
 assert.equal(d.canInfluenceProjection,false);
 assert.equal(d.scope.includes('not proof of current roster membership'),true);
});
test('contributor history with no verified provider ID stays unavailable',async()=>{
 let called=false;const env={DB:{prepare(){called=true;throw Error('unexpected')}}};
 const d=await loadSoccerPitchApiPlayerContributors(env,{league:'ger.1',teamIds:[],asOf:'2026-10-14'});
 assert.equal(called,false);assert.equal(d.players.length,0);
 assert.equal(d.missingReason,'no-verified-pitchapi-team-id');
});
test('null stat totals remain unavailable; never convert null to zero',async()=>{
 const env={DB:{prepare(){return{bind(){return{all:async()=>({results:[{player_id:'p_1',team_id:'t_1',player_name:'A',match_count:1,goals:null,assists:0,vaep_total:null}]})}}}}}}};
 const d=await loadSoccerPitchApiPlayerContributors(env,{league:'ger.1',teamIds:['t_1'],startDate:'2026-01-01',asOf:'2026-10-14'});
 assert.equal(d.players[0].goals,null);assert.equal(d.players[0].assists,0);assert.equal(d.players[0].vaep,null);
});
