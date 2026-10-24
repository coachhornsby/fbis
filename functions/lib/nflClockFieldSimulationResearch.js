/**
 * NFL play-clock and starting-field-position conditioned empirical challenger.
 *
 * Actual nflverse game_seconds_remaining denotes the pre-play clock. The
 * first-to-last-play span is ONLY a verified lower bound on elapsed possession
 * time; +25s and min/max clipping are research assumptions, not measured time.
 * This is neither a possession transition model nor an authorized live input.
 */
import {selectMatchupDriveHistory} from "./footballPossessionMatchupResearch.js";
import {runSportSimulationResearch} from "./sportSimulationResearch.js";
import {outcomeMetrics} from "./footballSimulationRankings.js";
import {sha256Hex} from "./sha256Hex.js";
const num=x=>typeof x==="number"&&Number.isFinite(x);
function requireEvidence(ok,reason){if(!ok)throw Error(reason)}
const eligible=d=>Number.isInteger(d.clockSpanLowerBound)&&d.clockSpanLowerBound>=0&&
 d.clockSpanLowerBound<=900&&Number.isInteger(d.gameClockFirst)&&
 d.gameClockFirst>=0&&d.gameClockFirst<=3600;
function seedFor(s){let x=2166136261;for(const ch of s)x=Math.imul(x^ch.charCodeAt(0),16777619);return x>>>0||1}
function pick(random,rows,score){
 const samples=Math.min(28,rows.length);
 let best=null,bestScore=Infinity;
 for(let i=0;i<samples;i++){
  const d=rows[Math.floor(random()*rows.length)];
  const merit=score(d)-Math.log(Math.max(random(),1e-12))*.45;
  if(merit<bestScore){bestScore=merit;best=d}
 }
 return best;
}
export function simulateNflClockFieldResearch({
 gameId,snapshotId,frozenAt,kickoff,homeTeamId,awayTeamId,
 projectedHome,projectedAway,trainingGames=[],iterations=150,
 historicalReconstruction=true
}={}){
 requireEvidence(
  /^[A-Za-z0-9:._-]+$/.test(String(gameId||""))&&
  /^[A-Za-z0-9:._-]+$/.test(String(snapshotId||""))&&
  Number.isFinite(Date.parse(frozenAt))&&Date.parse(frozenAt)<Date.parse(kickoff)&&
  [projectedHome,projectedAway].every(x=>num(x)&&x>=0&&x<=90)&&
  Number.isInteger(iterations)&&iterations>=100&&iterations<=5000,
  "NFL_CLOCK_INVALID_BASELINE");
 const history=selectMatchupDriveHistory(trainingGames,{sport:"nfl",
  targetGameId:gameId,frozenAt,homeTeamId,awayTeamId,historicalReconstruction});
 requireEvidence(history.eligible,"NFL_CLOCK_MATCHUP_HISTORY_INSUFFICIENT");
 const checked=history.training.flatMap(g=>g.drives);
 const clocked=checked.filter(eligible);
 requireEvidence(clocked.length>=600&&clocked.length/checked.length>=.75,
   "NFL_CLOCK_PLAY_TIMESTAMP_COVERAGE_INSUFFICIENT");
 for(const team of [homeTeamId,awayTeamId]){
  requireEvidence(history.offenseSamples.get(team)?.filter(eligible).length>=24 &&
   history.defenseSamples.get(team)?.filter(eligible).length>=24,
   "NFL_CLOCK_TEAM_CONTEXT_INSUFFICIENT");
 }
 const modelId="NFL-VERIFIED-PLAYCLOCK-FIELD-SHADOW-v0.2";
 const sourceFingerprint=sha256Hex(history.sourceFingerprint+"|"+modelId+"|clock-observed-lower-bound-v1");
 const seed=seedFor([gameId,snapshotId,frozenAt,modelId,sourceFingerprint].join("|"));
 const typicalDrives=Math.round(
  history.coverage[homeTeamId].meanPace+history.coverage[awayTeamId].meanPace);
 const maxDriveCount=Math.min(40,Math.max(16,typicalDrives+4));
 const model=runSportSimulationResearch({
  sport:"nfl",eventId:gameId,modelId,modelVersion:"0.2.0",
  publishedAt:frozenAt,eventStart:kickoff,iterations,seed,
  simulate:({random})=>{
   let home=0,away=0,remaining=3600,n=0;
   // Starting possession is not preverified in snapshot data.
   let side=random()<.5?"home":"away";
   let priorScored=false;
   while(remaining>0&&n<maxDriveCount){
    const team=side==="home"?homeTeamId:awayTeamId;
    const opponent=side==="home"?awayTeamId:homeTeamId;
    const offense=history.offenseSamples.get(team).filter(eligible);
    const allowed=history.defenseSamples.get(opponent).filter(eligible);
    const candidates=random()<.5?offense:allowed;
    const quarter=Math.min(4,1+Math.floor((3600-remaining)/900));
    const currentMargin=side==="home"?home-away:away-home;
    const fieldStart=priorScored?75:Math.round(
      candidates[Math.floor(random()*candidates.length)].startYardsToGoal);
    const selected=pick(random,candidates,d=>
      Math.abs(d.period-quarter)*.8+
      Math.abs(d.startYardsToGoal-fieldStart)/30+
      Math.abs(d.startMargin-currentMargin)/20);
    // The clock-span evidence covers first -> last observed snap only.
    // End-snap allowance and truncation are research assumptions.
    const consumed=Math.min(remaining,Math.max(30,Math.min(600,selected.clockSpanLowerBound+25)));
    remaining-=consumed;n++;
    if(side==="home"){home+=selected.offensePoints;away+=selected.defensePoints}
    else{away+=selected.offensePoints;home+=selected.defensePoints}
    priorScored=selected.offensePoints>=3||selected.defensePoints>=2;
    side=side==="home"?"away":"home";
   }
   return {metrics:{home_score:home,away_score:away,
    total:home+away,margin:home-away,drives:n,
    clock_remaining:remaining,...outcomeMetrics(home,away)}};
  }});
 return {...model,evidenceFingerprint:sourceFingerprint,
  clockedTrainingDrives:clocked.length,trainingGames:history.trainingGames,
  trainingDrives:history.trainingDrives,
  timeEvidence:"FIRST_TO_LAST_PLAY_CLOCK_SPAN_LOWER_BOUND",
  durationRule:"HEURISTIC_PLUS_25_SECONDS_CLIPPED_30_600",
  fieldPositionMode:"EMPIRICAL_START_DISTRIBUTION_NOT_STATEFUL_TRANSITIONS",
  modelingCautions:["NO_VERIFIED_PUNT_RETURN_TRANSITIONS","NO_TRUE_CLOCK_END_SNAP",
   "NO_OVERTIME","RECONSTRUCTED_SOURCE_NOT_HISTORICAL_PIT"],
  calibrationStatus:"NOT_VALIDATED",prospective:false,
  canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
