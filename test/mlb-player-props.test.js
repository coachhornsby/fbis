import test from "node:test";
import assert from "node:assert/strict";
import { buildMlbPersistentPlayerPropRows } from "../functions/lib/mlbPlayerPropModel.js";
import { canonicalizeProPlayerPropMarket } from "../functions/lib/proPlayerProps.js";

function sc(role,kRate=.22){
  return {
    role,kRate,
    global:{xwoba:.325,contactPerSwing:.76,whiffPerSwing:.24,hardHitRate:.39,barrelRate:.06,swingRate:.47},
    buckets:{"four_seam|middle_middle":{weight:20,whiffPerSwing:.24,contactPerSwing:.76,xwoba:.325,hardHitRate:.39,barrelRate:.06,velocity:94,spin:2300,pfxX:.1,pfxZ:1.2,extension:6.3}}
  };
}

test("MLB persistent prop engine emits requested pitcher and hitter markets",()=>{
  const game={
    id:"1",sport:"mlb",
    home:{abbr:"HOM"},away:{abbr:"AWY"},
    homeSp:{id:100,name:"Home Starter"},awaySp:{id:200,name:"Away Starter"},
    model:{projHome:4.8,projAway:4.1},
    mlbDeepShadow:{home:4.8,away:4.1,pitcherKs:{home:{projection:6.2,expectedInnings:5.8},away:{projection:5.5,expectedInnings:5.4}}},
    mlbPitchMatchup:{homeOffense:{runFactor:1.04,xwoba:.333,contactPerSwing:.77},awayOffense:{runFactor:.97,xwoba:.308,contactPerSwing:.74}},
    mlbContext:{palParkRunFactor:1.02,palParkHrFactor:1.05,weatherRunFactor:1},
    bpp:{batterMatchups:[]}
  };
  const hitter={id:"300",name:"Home Hitter",position:"RF",status:"Active",games:150,plateAppearances:630,hitPerPa:.24,totalBasesPerPa:.41,homeRunPerPa:.055,walkRate:.10,strikeoutRate:.21,statcastProfile:sc("batter",.21)};
  const state={
    fresh:true,
    homeStarter:{id:100,name:"Home Starter",era:3.2,whip:1.12,h9:7.5,bb9:2.4,bbRate:.065,expectedInnings:5.8,inningsPerStart:5.9,battersFacedPerInning:4.15,statcastProfile:sc("pitcher",.27),recentStarter:{rows:[{innings:6},{innings:5.2},{innings:6.1}]}},
    awayStarter:{id:200,name:"Away Starter",era:4.1,whip:1.31,h9:8.8,bb9:3.1,bbRate:.085,expectedInnings:5.4,inningsPerStart:5.5,battersFacedPerInning:4.3,statcastProfile:sc("pitcher",.23),recentStarter:{rows:[{innings:5},{innings:5.2},{innings:6}]}},
    homeTeam:{lineup:{activeHitters:[{id:"300"}]}},
    awayTeam:{lineup:{activeHitters:[]}},
    teamHitters:{home:{"300":hitter},away:{}},
    hitters:{"300":hitter},
  };
  const rows=buildMlbPersistentPlayerPropRows(game,state);
  const pitcher=new Set(rows.filter(r=>r.position==="P").map(r=>r.market));
  for(const market of ["pitcher_outs","hits_allowed","earned_runs","walks_allowed","pitch_count"])assert.ok(pitcher.has(market),market);
  const batter=new Set(rows.filter(r=>r.playerId==="300").map(r=>r.market));
  for(const market of ["strikeouts","hits","total_bases","home_runs","walks","runs","rbis","hits_runs_rbis"])assert.ok(batter.has(market),market);
  assert.ok(rows.every(r=>r.marketInformed===false));
  assert.ok(rows.every(r=>r.maturity==="RESEARCH_UNVALIDATED"));
  assert.ok(rows.filter(r=>r.position!=="P").every(r=>r.lineupState==="ROSTER_FALLBACK"));
});

test("MLB batter walks canonicalizes independently from pitcher walks allowed",()=>{
  assert.equal(canonicalizeProPlayerPropMarket("mlb","batter_walks"),"walks");
  assert.equal(canonicalizeProPlayerPropMarket("mlb","pitcher_walks"),"walks_allowed");
  assert.equal(canonicalizeProPlayerPropMarket("mlb","pitches_thrown"),"pitch_count");
  assert.equal(canonicalizeProPlayerPropMarket("mlb","h_r_rbi"),"hits_runs_rbis");
});
