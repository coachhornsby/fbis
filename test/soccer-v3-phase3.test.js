import test from "node:test";
import assert from "node:assert/strict";
import { projectSoccerV3, SOCCER_FBIS_V3_VERSION } from "../functions/lib/soccerFbisV3.js";

function rows(){
  const out=[];
  const start=Date.parse("2026-01-01T12:00:00Z");
  for(let i=0;i<100;i++){
    const date=new Date(start+i*86400000).toISOString().slice(0,10);
    out.push({
      pitch_match_id:"m"+i,match_date:date,start_time:date+"T18:00:00Z",
      home_team_id:"A",home_team_name:"Alpha",away_team_id:"B",away_team_name:"Beta",
      home_score:i%3===0?2:1,away_score:i%4===0?1:0,
      home_xg:1.55+(i%5)*0.03,away_xg:0.95+(i%4)*0.02,
      home_npxg:1.42,away_npxg:0.88,home_xgot:1.4,away_xgot:0.8,
      home_xg_per_shot:0.14,away_xg_per_shot:0.10,home_sot:5,away_sot:3,
      home_field_tilt:58,away_field_tilt:42,home_final_third_entries:44,away_final_third_entries:31,
      home_box_entries:16,away_box_entries:10,home_ppda:8.5,away_ppda:12.5,
      home_avg_defensive_action_x:47,away_avg_defensive_action_x:42,
      home_high_turnovers:7,away_high_turnovers:4,home_counterpress_regains:8,away_counterpress_regains:5,
      home_ball_recovery_time:7,away_ball_recovery_time:9,home_xt:1.2,away_xt:0.8,
      home_vaep:0.8,away_vaep:0.5,home_progressive_passes:44,away_progressive_passes:31,
      home_progressive_pass_distance:420,away_progressive_pass_distance:330,home_passes_into_box:13,away_passes_into_box:8,
      home_progressive_carries:18,away_progressive_carries:12,home_carries_into_final_third:15,away_carries_into_final_third:10,
      home_carries_into_box:8,away_carries_into_box:5,home_xag:1.1,away_xag:0.7,
      home_possession:57,away_possession:43,home_pass_accuracy:87,away_pass_accuracy:81,
      home_passes_per_sequence:4.1,away_passes_per_sequence:3.3,home_direct_speed:1.1,away_direct_speed:1.3,
      home_buildup_attacks:8,away_buildup_attacks:5,home_direct_attacks:5,away_direct_attacks:6,
      home_network_centralization:0.31,away_network_centralization:0.38
    });
  }
  return out;
}

test("soccer v3.1 Phase 3 score layer stays research-only and coherent",()=>{
  const history=rows();
  const v2={ok:true,pHomeWin:.55,pDraw:.25,pAwayWin:.20,home:1.45,away:1.05,total:2.5,margin:.4,pBttsYes:.49,pBttsNo:.51,totals:{"2.5":{over:.48,under:.52}},homeAsian:{"0":{win:.55,push:.25,loss:.20}}};
  const game={id:"target",start:"2026-05-01T18:00:00Z",home:{name:"Alpha"},away:{name:"Beta"}};
  const p=projectSoccerV3(game,v2,history);
  assert.equal(p.ok,true);
  assert.equal(SOCCER_FBIS_V3_VERSION,"research-v1.2-phase3-score-layer");
  assert.equal(p.scoreLayer.active,true);
  assert.ok(p.scoreLayer.weight>=.10&&p.scoreLayer.weight<=.22);
  assert.ok(p.home>0&&p.away>0&&p.total>0);
  assert.ok(p.pBttsYes>0&&p.pBttsYes<1);
  assert.ok(Math.abs(p.totals["2.5"].over+p.totals["2.5"].under-1)<1e-8);
  assert.ok(Math.abs(p.homeAsian["0"].win+p.homeAsian["0"].push+p.homeAsian["0"].loss-1)<1e-8);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.equal(p.provenance.marketUsed,false);
  assert.equal(p.provenance.persistentStateUsed,false);
});

test("soccer v3.1 Phase 3 score layer ignores post-cutoff feature rows",()=>{
  const base=rows();
  const v2={ok:true,pHomeWin:.52,pDraw:.27,pAwayWin:.21,home:1.4,away:1.1,total:2.5,margin:.3,pBttsYes:.5,pBttsNo:.5,totals:{"2.5":{over:.5,under:.5}},homeAsian:{"0":{win:.52,push:.27,loss:.21}}};
  const game={id:"target",start:"2026-05-01T18:00:00Z",home:{name:"Alpha"},away:{name:"Beta"}};
  const a=projectSoccerV3(game,v2,base);
  const future={...base.at(-1),pitch_match_id:"future",match_date:"2026-06-01",home_xg:9,away_xg:0.1,home_score:9,away_score:0};
  const b=projectSoccerV3(game,v2,[...base,future]);
  assert.equal(a.home,b.home);
  assert.equal(a.away,b.away);
  assert.equal(a.pHomeWin,b.pHomeWin);
  assert.equal(a.pDraw,b.pDraw);
  assert.equal(a.pAwayWin,b.pAwayWin);
});
