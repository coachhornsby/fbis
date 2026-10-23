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
  const homeLead=rate(distributions.home_regulation_lead?.mean);
  const awayLead=rate(distributions.away_regulation_lead?.mean);
  const ties=rate(distributions.regulation_tie?.mean);
  // Matchup favorite is determined by simulated lead frequency, never by home status
  // or average score. If the evidence is missing, leave the favorite unknown.
  const completeLeads=homeLead!==null&&awayLead!==null&&ties!==null&&
    Math.abs(homeLead+awayLead+ties-1)<0.005;
  const winnerSide=!completeLeads||Math.abs(homeLead-awayLead)<1e-9
    ?null:homeLead>awayLead?"home":"away";
  const winner=winnerSide==="home"?home:winnerSide==="away"?away:null;
  const loser=winnerSide==="home"?away:winnerSide==="away"?home:null;
  const wins=winnerSide==="home"?homeLead:winnerSide==="away"?awayLead:null;
  const blowout=winnerSide?rate(distributions[winnerSide+"_blowout_14"]?.mean):null;
  return {id:String(gameId),sport,kickoff,
    home:{name:home,abbr:homeAbbr||home,score:homeScore},
    away:{name:away,abbr:awayAbbr||away,score:awayScore},
    winner,winnerSide,loser,
    predictedScoreWinner:winnerSide==="home"?homeScore:winnerSide==="away"?awayScore:null,
    predictedScoreLoser:winnerSide==="home"?awayScore:winnerSide==="away"?homeScore:null,
    total,margin:Math.abs(homeMargin),homeMargin,homeWinPct:homeLead===null?null:rounded(homeLead*100),awayWinPct:awayLead===null?null:rounded(awayLead*100),
    winPct:wins===null?null:rounded(wins*100),
    blowoutPct:blowout===null?null:rounded(blowout*100),
    tiePct:ties===null?null:rounded(ties*100),blowoutThreshold:FOOTBALL_BLOWOUT_MARGIN,
    iterations,modelVersion,sourceFrozenAt,simulationFrozenAt,generatedAt,
    source,method,calibrationStatus,
    metricScope:"REGULATION_ONLY",overtimeMode:"NOT_MODELED",
    evaluation:{status:"NOT_GRADED",brierScore:null,logLoss:null,marginMAE:null,
      totalMAE:null,calibrationBuckets:null,blowout14Accuracy:null},
    probabilisticRankingType:"UNVALIDATED_RESEARCH_FREQUENCY",
    canAuthorizeWager:false,canQualify:false,changesProductionChampion:false,
    probabilityComplete:completeLeads&&wins!==null&&blowout!==null,
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
