import { simulateTennisMatch } from "./tennisFbisV1.js";

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

export function tennisTemporalEligible(row={}){
  const start=Date.parse(row.start||row.startTime||"");
  const frozen=Date.parse(row.frozenAt||row.snapshotAt||"");
  return Number.isFinite(start)&&Number.isFinite(frozen)&&frozen<start;
}

export function scoreTennisForecast(row={}){
  if(!tennisTemporalEligible(row))return {ok:false,reason:"post_start_or_missing_snapshot"};
  const actualWinner=Number(row.actualWinner);
  const p1=finite(row?.projection?.match?.pPlayer1Win??row.pPlayer1Win);
  const actualGames=finite(row.actualTotalGames);
  const projGames=finite(row?.projection?.match?.totalGames?.mean??row.projectedTotalGames);
  if((actualWinner!==0&&actualWinner!==1)||p1==null)return {ok:false,reason:"missing_outcome_or_probability"};
  const y=actualWinner===0?1:0;
  const eps=1e-12;
  const pc=Math.max(eps,Math.min(1-eps,p1));
  return {
    ok:true,
    brier:(pc-y)**2,
    logLoss:-(y*Math.log(pc)+(1-y)*Math.log(1-pc)),
    winnerCorrect:(pc>=0.5?0:1)===actualWinner?1:0,
    totalGamesAbsError:actualGames!=null&&projGames!=null?Math.abs(actualGames-projGames):null,
  };
}

export function evaluateTennisWalkForward(rows=[],{minimumN=500}={}){
  const scored=rows.map(scoreTennisForecast).filter(x=>x.ok);
  const gamesErrors=scored.map(x=>x.totalGamesAbsError).filter(Number.isFinite);
  const metrics={
    n:scored.length,
    brier:mean(scored.map(x=>x.brier)),
    logLoss:mean(scored.map(x=>x.logLoss)),
    winnerAccuracy:mean(scored.map(x=>x.winnerCorrect)),
    totalGamesMae:mean(gamesErrors),
  };
  return {
    metrics,
    promotion:{
      minimumN,
      pass:scored.length>=minimumN,
      decision:scored.length>=minimumN?"VALIDATION_SAMPLE_MET":"RESEARCH_ONLY",
      reason:scored.length>=minimumN?null:`requires_${minimumN}_temporal_matches`,
    },
  };
}

export function replayTennisRows(rows=[],playerContextById={}){
  return rows.filter(tennisTemporalEligible).map(row=>{
    const p1=playerContextById[row.player1Id]||row.player1||{};
    const p2=playerContextById[row.player2Id]||row.player2||{};
    return {
      ...row,
      projection:simulateTennisMatch({
        id:row.id,
        start:row.start,
        surface:row.surface,
        bestOf:row.bestOf,
        player1:{id:row.player1Id,...p1},
        player2:{id:row.player2Id,...p2},
      },{simulations:row.simulations||4000}),
    };
  });
}
