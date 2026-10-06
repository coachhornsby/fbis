import test from "node:test";
import assert from "node:assert/strict";
import {
  TennisDeepState,
  deepMatchupProfiles,
  simulateTennisDeepV11,
  deepPropDiagnostics,
  TENNIS_DEEP_MATCH_MODEL_ID,
} from "../functions/lib/tennisTwoSidedV11.js";

function row({
  winner="A",loser="B",surface="Hard",
  wAce=10,lAce=4,wDf=2,lDf=4,wSvpt=70,lSvpt=70,
  w1In=44,l1In=44,w1Won=34,l1Won=28,w2Won=14,l2Won=11,
  wSvGms=11,lSvGms=10,wBpSaved=3,wBpFaced=4,lBpSaved=4,lBpFaced=7
}={}){
  return {
    winner_id:winner,winner_name:winner,loser_id:loser,loser_name:loser,surface,
    w_ace:wAce,l_ace:lAce,w_df:wDf,l_df:lDf,w_svpt:wSvpt,l_svpt:lSvpt,
    w_1stIn:w1In,l_1stIn:l1In,w_1stWon:w1Won,l_1stWon:l1Won,w_2ndWon:w2Won,l_2ndWon:l2Won,
    w_SvGms:wSvGms,l_SvGms:lSvGms,w_bpSaved:wBpSaved,w_bpFaced:wBpFaced,l_bpSaved:lBpSaved,l_bpFaced:lBpFaced
  };
}

test("ace projection is two-sided: server ace skill and receiver ace allowance both matter",()=>{
  const base={
    id:"a",name:"A",firstServeIn:.62,firstServeWin:.72,secondServeWin:.52,servePointWin:.64,
    aceRate:.08,doubleFaultRate:.03,bpSaveRate:.62,bpFacedPerServiceGame:.3,servicePointsPerGame:6.4,
    returnPointWin:.36,returnFirstWin:.28,returnSecondWin:.48,aceAllowedRate:.06,dfReceivedRate:.03,
    bpCreatePerReturnGame:.3,bpConvertRate:.38,elo:1700,surfaceElo:{hard:1700},historyMatches:50,surfaceMatches:30
  };
  const easy={...base,id:"b",name:"B",aceAllowedRate:.12};
  const tough={...base,id:"c",name:"C",aceAllowedRate:.03};
  const [vsEasy]=deepMatchupProfiles(base,easy,{tour:"atp",surface:"hard"});
  const [vsTough]=deepMatchupProfiles(base,tough,{tour:"atp",surface:"hard"});
  assert.ok(vsEasy.aceRate>vsTough.aceRate);
});

test("deep state keeps independent surface histories and shrinks sparse surfaces",()=>{
  const s=new TennisDeepState("atp");
  for(let i=0;i<20;i++)s.update(row({winner:"A",loser:"B",wAce:12,lAce:3}),"hard");
  for(let i=0;i<4;i++)s.update(row({winner:"A",loser:"B",wAce:1,lAce:8}),"clay");
  const hard=s.profile("A","A","hard");
  const clay=s.profile("A","A","clay");
  assert.ok(hard.aceRate>clay.aceRate);
  assert.ok(hard.surfaceMatches>clay.surfaceMatches);
  assert.ok(clay.aceRate>0&&clay.aceRate<.2);
});

test("two-sided engine uses return quality to change match win probability",()=>{
  const state=new TennisDeepState("atp");
  for(let i=0;i<35;i++){
    state.update(row({winner:"A",loser:"B",wAce:8,lAce:5,w1Won:34,l1Won:26,w2Won:15,l2Won:9}),"hard");
    state.update(row({winner:"C",loser:"D",wAce:7,lAce:5,w1Won:32,l1Won:25,w2Won:14,l2Won:9}),"hard");
  }
  const a=state.profile("A","A","hard");
  const b=state.profile("B","B","hard");
  const c={...state.profile("C","C","hard"),returnFirstWin:.40,returnSecondWin:.58,returnPointWin:.46};
  const weakReturn={...b,returnFirstWin:.20,returnSecondWin:.38,returnPointWin:.29};
  const vsWeak=simulateTennisDeepV11({id:"x",tour:"atp",surface:"hard",bestOf:3,player1:a,player2:weakReturn},{simulations:1200},{seed:11,researchBacktest:true});
  const vsStrong=simulateTennisDeepV11({id:"y",tour:"atp",surface:"hard",bestOf:3,player1:a,player2:c},{simulations:1200},{seed:11,researchBacktest:true});
  assert.equal(vsWeak.modelId,TENNIS_DEEP_MATCH_MODEL_ID);
  assert.ok(vsWeak.match.pPlayer1Win>vsStrong.match.pPlayer1Win);
});

test("deep diagnostics expose both sides for ace and double-fault props",()=>{
  const base={
    id:"a",name:"A",firstServeIn:.62,firstServeWin:.72,secondServeWin:.52,servePointWin:.64,
    aceRate:.08,doubleFaultRate:.04,bpSaveRate:.62,bpFacedPerServiceGame:.3,servicePointsPerGame:6.4,
    returnPointWin:.36,returnFirstWin:.28,returnSecondWin:.48,aceAllowedRate:.07,dfReceivedRate:.05,
    bpCreatePerReturnGame:.3,bpConvertRate:.38,elo:1700,surfaceElo:{hard:1700},historyMatches:50,surfaceMatches:30
  };
  const p=simulateTennisDeepV11({id:"diag",tour:"atp",surface:"hard",bestOf:3,player1:base,player2:{...base,id:"b"}},{simulations:500},{seed:2,researchBacktest:true});
  const d=deepPropDiagnostics(p);
  assert.equal(d.length,2);
  assert.ok(Number.isFinite(d[0].ace.forRate));
  assert.ok(Number.isFinite(d[0].ace.opponentAllowedRate));
  assert.ok(Number.isFinite(d[0].ace.matchupRate));
  assert.ok(Number.isFinite(d[0].doubleFault.opponentReceivedRate));
});
