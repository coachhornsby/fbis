import test from 'node:test';
import assert from 'node:assert/strict';
import { pitchApiTeamNameKey, matchesPitchApiTeamName } from '../functions/lib/soccerPitchApiIdentity.js';
import { projectSoccerV3 } from '../functions/lib/soccerFbisV3.js';
import { findPitchApiFixture, persistPitchApiBundle } from '../functions/lib/soccerPitchApiStore.js';

const clubs=[
 ['t_bayern','Bayern München','Bayern Munich'],
 ['t_hsv','Hamburger SV','Hamburg SV'],
 ['t_union','Union Berlin','1. FC Union Berlin'],
 ['t_mainz','Mainz 05','Mainz'],
 ['t_elvers','Elversberg','SV Elversberg'],
 ['t_pad','Paderborn','SC Paderborn 07'],
 ['t_dortmund','Borussia Dortmund','Borussia Dortmund'],
 ['t_stuttgart','VfB Stuttgart','VfB Stuttgart'],
];

test('verified German aliases resolve only within the competition',()=>{
 for(const [,pitch,display] of clubs) {
  assert.equal(matchesPitchApiTeamName(pitch,display,'ger.1'),true,display);
  if(pitch!==display && pitchApiTeamNameKey(pitch,'')!==pitchApiTeamNameKey(display,'')) {
   assert.equal(matchesPitchApiTeamName(pitch,display,'fra.1'),false,display);
  }
 }
 assert.equal(matchesPitchApiTeamName('Mainz 05','Mainz United','ger.1'),false);
 assert.equal(matchesPitchApiTeamName('','Mainz','ger.1'),false);
});

test('Bundesliga v3 resolves actual historical PitchAPI team IDs from ESPN display names',()=>{
 const rows=[];
 for(let i=0;i<160;i++){
  const home=clubs[i%clubs.length],away=clubs[(i+1)%clubs.length];
  rows.push({pitch_match_id:'historical-'+i,league_key:'ger.1',match_date:'2025-01-'+String(i%28+1).padStart(2,'0'),
   status:'finished',home_team_id:home[0],home_team_name:home[1],away_team_id:away[0],away_team_name:away[1],
   home_score:i%4,away_score:(i+1)%3,home_xg:1.5,away_xg:1.1,home_ppda:8.5,away_ppda:9.5});
 }
 const v2={ok:true,pHomeWin:.47,pDraw:.26,pAwayWin:.27,home:1.4,away:1.1,total:2.5,margin:.3};
 for(let i=0;i<clubs.length;i++){
  const h=clubs[i],a=clubs[(i+1)%clubs.length];
  const p=projectSoccerV3({id:'future-'+i,soccerLeague:'ger.1',start:'2026-10-17T14:00:00Z',home:{name:h[2]},away:{name:a[2]}},v2,rows);
  assert.equal(p.ok,true,JSON.stringify({team:h[2],reason:p.reason,league:p.historyMatches,updates:p.classifierUpdates,home:p.homeHistory,away:p.awayHistory}));
  assert.equal(p.canAuthorize,false);
  assert.equal(p.provenance.marketUsed,false);
 }
});

test('PitchAPI future fixture identity uses competition-scoped aliases',async()=>{
 const row={pitch_match_id:'m_1',home_team_name:'Bayern München',away_team_name:'Union Berlin'};
 const env={DB:{prepare(){return{bind(){return{all:async()=>({results:[row]})}}}}}};
 const match=await findPitchApiFixture(env,{leagueKey:'ger.1',date:'2026-10-17',homeName:'Bayern Munich',awayName:'1. FC Union Berlin'});
 assert.equal(match?.pitch_match_id,'m_1');
 const other=await findPitchApiFixture(env,{leagueKey:'fra.1',date:'2026-10-17',homeName:'Bayern Munich',awayName:'1. FC Union Berlin'});
 assert.equal(other,null);
});

test('PitchAPI persistence leaves absent scalar stats null instead of manufactured zero',async()=>{
 const binds=[];
 const env={DB:{prepare(){return{bind(...xs){binds.push(xs);return{run:async()=>({success:true})}}}}}};
 const result=await persistPitchApiBundle(env,{leagueKey:'ger.1',observedAt:'2026-10-14T00:00:00Z',
  match:{id:'m_missing',date:'2026-10-10',status:'finished',homeTeam:{id:'h',name:'Home'},awayTeam:{id:'a',name:'Away'}},
  features:{homeXg:null,awayXg:0,homeBigChances:null,awayBigChances:0}});
 assert.equal(result.ok,true);
 // Initial write: homeXg,awayXg at offsets 15,16; big chances 23,24.
 assert.equal(binds[0][15],null);
 assert.equal(binds[0][16],0);
 assert.equal(binds[0][23],null);
 assert.equal(binds[0][24],0);
});
