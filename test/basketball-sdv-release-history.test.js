import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSdvBasketballReleaseGame} from "../functions/lib/basketballSdvReleaseHistory.js";
const hash="a".repeat(64),observedAt="2026-10-20T23:00:00Z";
function fixture(sport="nba",opts={}){
 const nba=sport==="nba",count=nba?92:64,rows=[];
 let home=0,away=0;
 for(let i=0;i<count*2;i++){
  const p=i%2===0?"home":"away",points=i%4===0?2:i%5===0?3:0;
  if(p==="home")home+=points;else away+=points;
  const period=1+Math.floor(i/(count*2/(nba?4:2)));
  rows.push(nba?{game_id:"0022500001",period,possession_number:i+1,
   start_order_index:i+1,offense_team_id:p==="home"?1611:1612,
   defense_team_id:p==="home"?1612:1611,points,count_as_possession:true}:
   {contest_id:"1111",period,poss_num:i+1,
    poss_team_ncaa_team_id:p==="home"?"ncaa-1":"ncaa-2",
    home_ncaa_team_id:"ncaa-1",away_ncaa_team_id:"ncaa-2",
    home:"Cats",away:"Dogs",pts:points});
 }
 const schedule=nba?{game_id:"0022500001",home_team_id:1611,away_team_id:1612,
  home_pts:home,away_pts:away,game_date:"2026-03-01"}:
  {contest_id:"1111",home:"Cats",away:"Dogs",home_score:home,away_score:away,
   game_date:"2026-03-01"};
 return{sport,gameId:nba?"0022500001":"1111",season:2026,
  rows,schedule,observedAt,sourceArtifactHash:hash,...opts};
}
for(const sport of ["nba","cbb"]){
 test(sport+" genuine release rows can reconcile scores without fabricating kickoff",()=>{
  const got=normalizeSdvBasketballReleaseGame(fixture(sport));
  assert.equal(got.status,"SCORE_RECONCILED_TIPOFF_UNVERIFIED");
  assert.equal(got.ok,true);
  assert.equal(got.canQualify,false);
  assert.equal(got.canAuthorizeWager,false);
  assert.equal(got.sourceObservedAt,new Date(observedAt).toISOString());
  assert.equal(got.count,sport==="nba"?184:128);
  assert.equal(got.game,undefined);
 });
 test(sport+" qualifies as verified historical input only with independently fingerprinted exact tipoff",()=>{
  const base=fixture(sport),tipoff="2026-03-01T20:00:00Z";
  const evidence={gameId:base.gameId,tipoff,sourceFingerprint:"b".repeat(64),verified:true};
  const good=normalizeSdvBasketballReleaseGame({...base,tipoff,tipoffEvidence:evidence});
  assert.equal(good.status,"VERIFIED_HISTORICAL_GAME");
  assert.equal(good.game.tipoff,new Date(tipoff).toISOString());
  assert.equal(good.game.regulationOnly,true);
  assert.equal(good.game.canAuthorizeWager,false);
  const wrong=normalizeSdvBasketballReleaseGame({...base,tipoff,
   tipoffEvidence:{...evidence,tipoff:"2026-03-01T21:00:00Z"}});
  assert.equal(wrong.status,"SCORE_RECONCILED_TIPOFF_UNVERIFIED");
 });
 test(sport+" source mismatch and score corrections cannot be normalized into false results",()=>{
  const base=fixture(sport);
  const score=sport==="nba"?"home_pts":"home_score";
  assert.throws(()=>normalizeSdvBasketballReleaseGame({...base,
   schedule:{...base.schedule,[score]:base.schedule[score]+2}}),
   /SDV_REGULATION_SCORE_MISMATCH_OR_OVERTIME/);
  assert.throws(()=>normalizeSdvBasketballReleaseGame({...base,
   sourceArtifactHash:"not-a-hash"}),/SDV_POSSESSION_RELEASE_PROVENANCE_INVALID/);
  assert.throws(()=>normalizeSdvBasketballReleaseGame({...base,
   rows:[...base.rows,{...base.rows[0]}]}),/SDV_DUPLICATE_POSSESSION_ID/);
 });
}
test("NBA historical source rejects non-count scoring continuation and defender mismatch",()=>{
 const base=fixture("nba");
 assert.throws(()=>normalizeSdvBasketballReleaseGame({...base,
  rows:base.rows.map((r,i)=>i===0?{...r,count_as_possession:false}:r)}),
  /SDV_NONCOUNT_POSSESSION_HAS_POINTS/);
 assert.throws(()=>normalizeSdvBasketballReleaseGame({...base,
  rows:base.rows.map((r,i)=>i===0?{...r,defense_team_id:1611}:r)}),
  /SDV_POSSESSION_DEFENSE_TEAM_MISMATCH/);
});
test("CBB uses NCAA contest identity and explicit home/away name crosscheck",()=>{
 const base=fixture("cbb");
 assert.throws(()=>normalizeSdvBasketballReleaseGame({...base,
  schedule:{...base.schedule,home:"Different"}}),
  /SDV_CBB_SCHEDULE_TEAM_NAMES_MISMATCH/);
});
