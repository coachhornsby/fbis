import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSdvBasketballPbpPossessions,attachVerifiedNbaPossessionOwners} from "../functions/lib/basketballSdvPbpAdapter.js";
function input(sport,{invalidOwner=false,crossScore=false}={}){
 const rows=[],half=sport==="nba"?45:32,periods=sport==="nba"?4:2;
 let home=0,away=0;
 for(let k=0;k<half*2;k++){
  for(const off of ["home","away"]){
   const points=k%3===0?2:k%5===0?3:0;
   if(off==="home")home+=points;else away+=points;
   rows.push({
    period_number:1+Math.floor(k/(half*2/periods)),
    poss_num:k*2+(off==="home"?1:2),
    possession_number:k*2+(off==="home"?1:2),
    game_play_number:rows.length+1,order_index:rows.length+1,
    poss_team_espn_team_id:invalidOwner?"":off==="home"?"h":"a",
    verified_possession_owner_team_id:invalidOwner?"":off==="home"?"h":"a",
    home_score:crossScore&&k===0&&off==="home"?home+1:home,away_score:away
   });
  }
 }
 return {sport,gameId:"g1",season:2026,
  homeTeamId:"h",awayTeamId:"a",
  tipoff:"2026-10-01T17:00:00Z",observedAt:"2026-10-02T01:00:00Z",
  sourceFingerprint:"b".repeat(64),events:rows,
  regulationEndScore:{home,away}};
}
for(const sport of ["nba","cbb"]){
 test(sport+" official-possession owner produces fully reconciled points and counts",()=>{
  const g=normalizeSdvBasketballPbpPossessions(input(sport));
  assert.equal(g.sport,sport);
  assert.equal(g.possessions.length,sport==="nba"?180:128);
  assert.equal(g.possessions.filter(p=>p.offense==="home").reduce((n,p)=>n+p.points,0),g.homeRegulationScore);
  assert.equal(g.possessions.filter(p=>p.offense==="away").reduce((n,p)=>n+p.points,0),g.awayRegulationScore);
  assert.equal(g.canAuthorizeWager,false);
 });
 test(sport+" blocks unverified offense team or invented score revisions",()=>{
  assert.throws(()=>normalizeSdvBasketballPbpPossessions(input(sport,{invalidOwner:true})),/OWNER_UNVERIFIED/);
  assert.throws(()=>normalizeSdvBasketballPbpPossessions(input(sport,{crossScore:true})),/CROSS_TEAM_SCORE_UNASSIGNED|SCORE_DISCONTINUITY|REGULATION_BOUNDARY_MISMATCH/);
 });
}
test("NBA Stats team_id is not a valid substitute for proven offensive possession owner",()=>{
 const x=input("nba",{invalidOwner:true});
 x.events.forEach(r=>r.team_id="h");
 assert.throws(()=>normalizeSdvBasketballPbpPossessions(x),/OWNER_UNVERIFIED/);
});
test("An overtime-only row does not enter the regulation score distribution",()=>{
 const x=input("cbb");
 x.events.push({period:3,game_play_number:999,home_score:99,away_score:99});
 const r=normalizeSdvBasketballPbpPossessions(x);
 assert.equal(r.overtimeExcluded,true);
 assert.equal(r.possessions.length,128);
});

test("NBA Stats offensive lineup identity can verify owners without trusting action team_id",()=>{
 const x=input("nba",{invalidOwner:true});
 const memberships={};
 for(let i=0;i<5;i++){memberships["h"+i]="h";memberships["a"+i]="a";}
 const withLineups=x.events.map(r=>{
  const team=r.possession_number%2===1?"h":"a";
  return {...r,team_id:team==="h"?"a":"h",...Object.fromEntries(
   Array.from({length:5},(_,i)=>["off_player_"+(i+1),team+i]))};
 });
 const verified=attachVerifiedNbaPossessionOwners(withLineups,{
  homeTeamId:"h",awayTeamId:"a",playerTeamMap:memberships,
  rosterSourceFingerprint:"c".repeat(64)});
 const normalized=normalizeSdvBasketballPbpPossessions({...x,events:verified});
 assert.equal(normalized.possessions.length,180);
 assert.equal(verified[0].team_id,"a");
 assert.equal(verified[0].verified_possession_owner_team_id,"h");
});
test("NBA incomplete or contradictory verified offensive units fail closed",()=>{
 const x=input("nba",{invalidOwner:true});
 const teams={};
 for(let i=0;i<5;i++){teams["h"+i]="h";teams["a"+i]="a";}
 const rows=x.events.map(r=>({...r,...Object.fromEntries(
  Array.from({length:5},(_,i)=>["off_player_"+(i+1),(r.possession_number%2===1?"h":"a")+i]))}));
 const identity={homeTeamId:"h",awayTeamId:"a",playerTeamMap:teams,
  rosterSourceFingerprint:"d".repeat(64)};
 assert.throws(()=>attachVerifiedNbaPossessionOwners(rows.map((r,i)=>i===0?{...r,off_player_1:null}:r),identity),
  /NBA_POSSESSION_OWNER_NOT_LINEUP_VERIFIED/);
 const conflict=[...rows,{...rows[0],action_number:999,...Object.fromEntries(
  Array.from({length:5},(_,i)=>["off_player_"+(i+1),"a"+i]))}];
 assert.throws(()=>attachVerifiedNbaPossessionOwners(conflict,identity),/NBA_POSSESSION_OWNER_NOT_LINEUP_VERIFIED/);
});
