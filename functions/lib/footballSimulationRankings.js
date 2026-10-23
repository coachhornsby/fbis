/**
 * Same-draw regulation winner and 14-point blowout counts for all football
 * research simulations. This never qualifies bets or manufactures data.
 */
const finite = x => typeof x === "number" && Number.isFinite(x);
export const FOOTBALL_BLOWOUT_MARGIN = 14;
export const FOOTBALL_OUTCOME_METRICS = Object.freeze([
  "home_regulation_lead", "away_regulation_lead", "regulation_tie",
  "home_blowout_14", "away_blowout_14",
]);
export function outcomeMetrics(home, away) {
  if(!finite(home)||!finite(away)||home<0||away<0)throw Error("INVALID_SIMULATED_SCORE");
  const d=home-away;
  return {home_regulation_lead:Number(d>0),away_regulation_lead:Number(d<0),
    regulation_tie:Number(d===0),home_blowout_14:Number(d>=14),
    away_blowout_14:Number(d<=-14)};
}
const rounded=x=>Math.round((x+Number.EPSILON)*10)/10;
const rate=x=>finite(x)&&x>=0&&x<=1?x:null;
export function rankFootballDistribution({
  sport,gameId,kickoff,home,away,homeAbbr,awayAbbr,iterations,modelVersion,
  sourceFrozenAt,simulationFrozenAt,distributions,calibrationStatus="NOT_VALIDATED",
  source="RESEARCH",method,generatedAt=null,
}={}){
  if(!["nfl","cfb"].includes(sport)||!gameId||
      !finite(iterations)||iterations<100||!distributions)throw Error("INVALID_RANKING_IDENTITY");
  const h=distributions.home_score?.mean,a=distributions.away_score?.mean;
  if(!finite(h)||!finite(a)||h<0||a<0)throw Error("INCOMPLETE_SIMULATED_SCORES");
  const homeScore=rounded(h),awayScore=rounded(a);
  // Every display total and margin comes from the SAME two displayed scores.
  const homeMargin=rounded(homeScore-awayScore);
  const total=rounded(homeScore+awayScore);
  const winnerSide=homeMargin>=0?"home":"away";
  const winner=winnerSide==="home"?home:away,loser=winnerSide==="home"?away:home;
  const wins=rate(distributions[winnerSide+"_regulation_lead"]?.mean
    ??(winnerSide==="home"?distributions.home_regulation_lead?.mean:null));
  const ties=rate(distributions.regulation_tie?.mean);
  const blowout=rate(distributions[winnerSide+"_blowout_14"]?.mean);
  return {id:String(gameId),sport,kickoff,
    home:{name:home,abbr:homeAbbr||home,score:homeScore},
    away:{name:away,abbr:awayAbbr||away,score:awayScore},
    winner,winnerSide,loser,
    predictedScoreWinner:winnerSide==="home"?homeScore:awayScore,
    predictedScoreLoser:winnerSide==="home"?awayScore:homeScore,
    total,margin:Math.abs(homeMargin),homeMargin,
    winPct:wins===null?null:rounded(wins*100),
    blowoutPct:blowout===null?null:rounded(blowout*100),
    tiePct:ties===null?null:rounded(ties*100),blowoutThreshold:FOOTBALL_BLOWOUT_MARGIN,
    iterations,modelVersion,sourceFrozenAt,simulationFrozenAt,generatedAt,
    source,method,calibrationStatus,
    metricScope:"REGULATION_ONLY",overtimeMode:"NOT_MODELED",
    probabilisticRankingType:"UNVALIDATED_RESEARCH_FREQUENCY",
    canAuthorizeWager:false,canQualify:false,changesProductionChampion:false,
    probabilityComplete:wins!==null&&blowout!==null&&ties!==null,
  };
}
export function sortFootballRankings(rows,field="winPct",direction="desc"){
 const fields=new Set(["winPct","blowoutPct","total","margin","kickoff","tiePct"]);
 if(!fields.has(field))throw Error("UNSUPPORTED_RANKING_SORT");
 const dir=direction==="asc"?1:-1;
 return [...rows].sort((a,b)=>{
   const av=a[field],bv=b[field];
   if(av==null&&bv!=null)return 1;
   if(bv==null&&av!=null)return -1;
   const cmp=field==="kickoff"?String(av).localeCompare(String(bv)):av-bv;
   return (cmp||String(a.id).localeCompare(String(b.id)))*dir;
 });
}
