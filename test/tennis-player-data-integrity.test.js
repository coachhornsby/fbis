import test from "node:test";
import assert from "node:assert/strict";
import {
  auditTennisCsv,assertTennisCoverage,validateTennisProjectionProfile,
  TENNIS_MIN_LIVE_SAMPLE_MATCHES
} from "../functions/lib/tennisPlayerDataIntegrity.js";
import { simulateTennisMatch } from "../functions/lib/tennisFbisV1.js";

const header="tourney_id,tourney_name,surface,tourney_level,tourney_date,winner_id,winner_name,loser_id,loser_name,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced";
const row="x,Test,Hard,C,20261001,A1,A Player,B1,B Player,5,2,60,36,27,13,10,4,6,4,3,62,38,25,12,10,3,5";

test("tennis source audit rejects empty, HTML, header-only and missing-stat inputs",()=>{
  for(const text of ["","<html>error</html>",header+"\n"]){
    assert.equal(auditTennisCsv(text,{sourceClass:"ATP_CHALLENGER",year:2025}).safe,false);
  }
  const missing="tourney_id,winner_name,loser_name\nx,A,B\n";
  const a=auditTennisCsv(missing,{sourceClass:"ATP_CHALLENGER",year:2025});
  assert.equal(a.safe,false);
  assert.ok(a.reasons.includes("required_serve_columns_missing"));
});

test("tennis source audit accepts populated Sackmann-compatible serve rows",()=>{
  const a=auditTennisCsv(header+"\n"+row+"\n",{sourceClass:"ATP_CHALLENGER",year:2025});
  assert.equal(a.safe,true);
  assert.equal(a.rows,1);
  assert.equal(a.serveCoverage,1);
  assert.equal(a.distinctPlayers,2);
  assert.deepEqual(a.levels,["C"]);
});

test("coverage contract requires Tour and Challenger classes independently",()=>{
  const good=(sourceClass,year)=>({sourceClass,year,safe:true});
  assert.throws(()=>assertTennisCoverage([
    good("ATP_TOUR",2024),good("ATP_TOUR",2025),good("ATP_CHALLENGER",2024)
  ],{requiredTourYears:[2024,2025],requiredChallengerYears:[2024,2025]}),/Challenger missing \[2025\]/);
  assert.equal(assertTennisCoverage([
    good("ATP_TOUR",2024),good("ATP_TOUR",2025),good("ATP_CHALLENGER",2024),good("ATP_CHALLENGER",2025)
  ],{requiredTourYears:[2024,2025],requiredChallengerYears:[2024,2025]}),true);
});

const historical={
  id:"a",name:"Historical",elo:1700,surfaceElo:{hard:1720},
  servePointWinPct:.64,returnPointWinPct:.38,aceRate:.07,doubleFaultRate:.035,
  historyMatches:40,surfaceMatches:25,_profileType:"historical",_sampleMatches:25,
};
test("projection profile validation distinguishes historical, live-thin and inadequate live samples",()=>{
  const h=validateTennisProjectionProfile(historical,{surface:"hard"});
  assert.equal(h.ok,true);assert.equal(h.thinSample,false);
  const live={...historical,elo:undefined,surfaceElo:undefined,_profileType:"live",_sampleMatches:TENNIS_MIN_LIVE_SAMPLE_MATCHES,surfaceMatches:undefined};
  const l=validateTennisProjectionProfile(live,{surface:"hard"});
  assert.equal(l.ok,true);assert.equal(l.thinSample,true);
  const bad={...live,_sampleMatches:TENNIS_MIN_LIVE_SAMPLE_MATCHES-1};
  assert.equal(validateTennisProjectionProfile(bad,{surface:"hard"}).ok,false);
});

test("unresolved neutral-default player cannot receive a normal projection",()=>{
  const unresolved={name:"Unknown",_profileType:"cold-start",_sampleMatches:0};
  const out=simulateTennisMatch({id:"guard",surface:"hard",player1:historical,player2:unresolved},{simulations:1000},{seed:3});
  assert.equal(out.ok,false);
  assert.equal(out.status,"NO VALID PROJECTION");
  assert.equal(out.reason,"INSUFFICIENT PLAYER DATA");
  assert.equal(out.canAuthorizeWager,false);
});

test("valid profiles expose side-specific straight-set and deciding-set probabilities",()=>{
  const b={...historical,id:"b",name:"B",elo:1650,surfaceElo:{hard:1640}};
  const out=simulateTennisMatch({id:"shape",surface:"hard",bestOf:3,player1:historical,player2:b},{simulations:1500},{seed:11});
  assert.equal(out.ok,true);
  for(const k of ["pPlayer1StraightSets","pPlayer2StraightSets","pDecidingSet"])assert.ok(out.match[k]>=0&&out.match[k]<=1,k);
  assert.ok(Math.abs(out.match.pPlayer1StraightSets+out.match.pPlayer2StraightSets+out.match.pDecidingSet-1)<.02);
});
