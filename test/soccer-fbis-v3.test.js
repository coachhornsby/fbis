import test from "node:test";
import assert from "node:assert/strict";
import { projectSoccerV3, SOCCER_FBIS_V3_ID } from "../functions/lib/soccerFbisV3.js";
import { persistPitchApiBundle, pitchApiRowToGame } from "../functions/lib/soccerPitchApiStore.js";

function row(i,home,away,hs,as){
  return {
    pitch_match_id:`m_${i}`,league_key:"eng.1",match_date:`2026-${String(1+Math.floor(i/28)).padStart(2,"0")}-${String(1+i%28).padStart(2,"0")}`,
    status:"finished",home_team_id:home.id,home_team_name:home.name,away_team_id:away.id,away_team_name:away.name,
    home_score:hs,away_score:as,
    home_xg:2.0,away_xg:.9,home_xgot:1.4,away_xgot:.6,home_shots:15,away_shots:8,home_sot:6,away_sot:3,
    home_field_tilt:61,away_field_tilt:39,home_final_third_entries:70,away_final_third_entries:43,home_box_entries:24,away_box_entries:12,
    home_ppda:8,away_ppda:13,home_high_turnovers:9,away_high_turnovers:4,home_counterpress_regains:12,away_counterpress_regains:7,
    home_ball_recovery_time:13,away_ball_recovery_time:19,home_xt:.9,away_xt:.45,home_vaep:.35,away_vaep:.15,
    home_progressive_passes:48,away_progressive_passes:29,home_progressive_carries:22,away_progressive_carries:12,
    home_xag:1.3,away_xag:.6,home_possession:58,away_possession:42,home_passes_per_sequence:4.8,away_passes_per_sequence:3.1,
    home_direct_speed:1.2,away_direct_speed:1.5
  };
}
test("v3 remains unavailable until enough PitchAPI evidence exists",()=>{
  const a={id:"a",name:"Alpha"},b={id:"b",name:"Beta"};
  const p=projectSoccerV3({start:"2026-08-01",home:{name:"Alpha"},away:{name:"Beta"}},{ok:true,pHomeWin:.55,pDraw:.25,pAwayWin:.20},[
    row(1,a,b,2,0),row(2,b,a,1,1)
  ]);
  assert.equal(p.ok,false);
  assert.equal(p.modelId,SOCCER_FBIS_V3_ID);
});
test("v3 activates after sufficient causal advanced history and stays normalized",()=>{
  const teams=[{id:"a",name:"Alpha"},{id:"b",name:"Beta"},{id:"c",name:"Gamma"},{id:"d",name:"Delta"}],rows=[];
  for(let i=0;i<120;i++){
    const h=teams[i%4],a=teams[(i+1+(i%2))%4]; if(h.id===a.id)continue;
    rows.push(row(i,h,a,i%3===0?3:2,i%5===0?2:1));
  }
  const p=projectSoccerV3({start:"2027-01-01",home:{name:"Alpha"},away:{name:"Beta"}},{ok:true,pHomeWin:.52,pDraw:.26,pAwayWin:.22},rows);
  assert.equal(p.ok,true);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.ok(Math.abs(p.pHomeWin+p.pDraw+p.pAwayWin-1)<1e-9);
  assert.ok(p.ensemble.pitchApiWeight>0);
  assert.ok(p.pitchapi.featureFamilies.includes("shot-quality"));
});
test("PitchAPI persistence binds the canonical match insert exactly",async()=>{
  const calls=[];
  const env={DB:{prepare(sql){return{bind(...args){calls.push({sql,args});return{run:async()=>({success:true})};}}}}};
  const r=await persistPitchApiBundle(env,{
    leagueKey:"eng.1",season:"2025/2026",observedAt:"2026-01-02T00:00:00Z",
    match:{id:"m_abc",date:"2026-01-01",startTime:"2026-01-01T15:00:00Z",status:"finished",
      homeTeam:{id:"t_h",name:"Home"},awayTeam:{id:"t_a",name:"Away"},homeScore:2,awayScore:1},
    features:{homeXg:1.8,awayXg:.7,homePpda:8.2,awayPpda:12.4},
    players:[],lineups:[]
  });
  assert.equal(r.ok,true);
  const first=calls[0];
  assert.equal((first.sql.match(/\?/g)||[]).length,first.args.length);
  assert.match(first.sql,/home_xg/);
  assert.ok(first.args.includes(1.8));
});
test("historical lineup observations are explicitly post-match when fetched later",async()=>{
  const calls=[];
  const env={DB:{prepare(sql){return{bind(...args){calls.push({sql,args});return{run:async()=>({success:true})};}}}}};
  await persistPitchApiBundle(env,{
    leagueKey:"eng.1",observedAt:"2026-01-02T00:00:00Z",
    match:{id:"m_line",date:"2026-01-01",startTime:"2026-01-01T15:00:00Z",status:"finished",
      homeTeam:{id:"t_h",name:"Home"},awayTeam:{id:"t_a",name:"Away"},homeScore:1,awayScore:0},
    features:{},players:[],lineups:[{side:"home",teamId:"t_h",confirmed:true,starters:[{player_id:"p1"}]}]
  });
  const lineup=calls.find(x=>/soccer_pitchapi_lineup_observations/.test(x.sql));
  assert.ok(lineup);
  assert.equal(lineup.args[13],0);
  assert.equal(lineup.args[14],1);
});


test("PitchAPI board fixture exposes an explicit null market shell",()=>{
  const g=pitchApiRowToGame({
    pitch_match_id:"m_future",league_key:"usa.1",match_date:"2026-10-07",
    start_time:"2026-10-07T00:30:00Z",status:"not_started",
    home_team_id:"h",home_team_name:"Home",away_team_id:"a",away_team_name:"Away"
  });
  assert.deepEqual(g.odds,{
    spread:null,total:null,homeMl:null,awayMl:null,details:"",book:null
  });
});
