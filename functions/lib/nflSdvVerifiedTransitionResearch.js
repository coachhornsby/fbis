/**
 * NFL SDV verified possession time + next-field research challenger v0.3.
 *
 * Uses nflfastR's drive_time_of_possession and named drive transitions.
 * Source time is an official dataset value, not an invented last-play allowance.
 * Observed next-drive starting spot is a descriptive linked field observation,
 * NOT a causal punt/turnover or special-teams physics model. Research only.
 */
import {selectMatchupDriveHistory} from "./footballPossessionMatchupResearch.js";
import {runSportSimulationResearch} from "./sportSimulationResearch.js";
import {outcomeMetrics} from "./footballSimulationRankings.js";
import {sha256Hex} from "./sha256Hex.js";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
function check(x,reason){if(!x)throw Error(reason)}
const duration=d=>Number.isInteger(d.officialDurationSeconds)&&
 d.officialDurationSeconds>=0&&d.officialDurationSeconds<=1800;
const valid=d=>d.sourceNormalizerVersion==="NFL_PBP_NORMALIZER_v0.3.1"&&
 duration(d)&&Number.isInteger(d.officialStartYardsToGoal)&&
 d.officialStartYardsToGoal>=0&&d.officialStartYardsToGoal<=100&&
 typeof d.startTransition==="string"&&d.startTransition.length>=2&&
 typeof d.endTransition==="string"&&d.endTransition.length>=2;
export function mapHistoricalNextOffenseToTarget(d,currentSide){
 if(!["home","away"].includes(currentSide)||!["home","away"].includes(d?.offense)||
    !["home","away"].includes(d?.observedNextOffense))return null;
 return d.observedNextOffense===d.offense?currentSide:
   currentSide==="home"?"away":"home";
}
function seedFor(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)||1}
function category(label){
 const s=String(label||"").toUpperCase();
 if(/KICK|EXTRA_POINT|PAT/.test(s))return "KICKOFF";
 if(/PUNT/.test(s))return "PUNT";
 if(/FUMBLE|INTERCEPT|TURNOVER/.test(s))return "TURNOVER";
 if(/DOWNS/.test(s))return "DOWNS";
 if(/HALF|QUARTER|END_OF|PERIOD/.test(s))return "PERIOD";
 if(/SCORE|TOUCHDOWN|FIELD_GOAL/.test(s))return "SCORE";
 return s;
}
function pick(random,arr,score){
 let selected=null,best=Infinity;
 for(let i=0;i<Math.min(32,arr.length);i++){
  const d=arr[Math.floor(random()*arr.length)];
  const value=score(d)-Math.log(Math.max(1e-12,random()))*.36;
  if(value<best){selected=d;best=value}
 }
 return selected;
}
export function simulateNflVerifiedDriveTransitionShadow({
 gameId,snapshotId,frozenAt,kickoff,homeTeamId,awayTeamId,
 projectedHome,projectedAway,trainingGames=[],iterations=250,
 historicalReconstruction=false,
}={}){
 check(typeof gameId==="string"&&/^[A-Za-z0-9:._-]{1,120}$/.test(gameId)&&
 typeof snapshotId==="string"&&/^[A-Za-z0-9:._-]{1,120}$/.test(snapshotId)&&
 [homeTeamId,awayTeamId].every(x=>typeof x==="string"&&x.length>0)&&homeTeamId!==awayTeamId&&
 Number.isFinite(Date.parse(frozenAt))&&Date.parse(frozenAt)<Date.parse(kickoff)&&
 [projectedHome,projectedAway].every(x=>finite(x)&&x>=0&&x<=90)&&
 Number.isInteger(iterations)&&iterations>=100&&iterations<=5000,
 "NFL_TRANSITION_INVALID_BASELINE");
 const history=selectMatchupDriveHistory(trainingGames,{
  sport:"nfl",targetGameId:gameId,frozenAt,homeTeamId,awayTeamId,
  historicalReconstruction,
 });
 check(history.eligible,"NFL_TRANSITION_TEAM_HISTORY_INSUFFICIENT");
 const all=history.training.flatMap(g=>g.drives);
 const certified=all.filter(valid);
 const linked=certified.filter(d=>Number.isInteger(d.observedNextStartYardsToGoal)&&
  ["home","away"].includes(d.observedNextOffense)&&
  typeof d.observedNextStartTransition==="string");
 check(certified.length>=500&&certified.length/all.length>=.65&&
   linked.length>=350&&linked.length/certified.length>=.60,
 "NFL_TRANSITION_OFFICIAL_SOURCE_COVERAGE_INSUFFICIENT");
 for(const team of [homeTeamId,awayTeamId]){
  check(history.offenseSamples.get(team).filter(valid).length>=24&&
   history.defenseSamples.get(team).filter(valid).length>=24,
   "NFL_TRANSITION_TEAM_SOURCE_COVERAGE_INSUFFICIENT");
 }
 const modelId="NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3.1";
 const evidenceFingerprint=sha256Hex([modelId,history.sourceFingerprint,"OFFICIAL_DRIVE_TIME_AND_LINKED_TRANSITIONS"].join("|"));
 const seed=seedFor([modelId,gameId,snapshotId,frozenAt,evidenceFingerprint].join("|"));
 const scoredTotal=projectedHome+projectedAway,scoredMargin=projectedHome-projectedAway;
 const result=runSportSimulationResearch({
  sport:"nfl",eventId:gameId,modelId,modelVersion:"0.3.1",
  publishedAt:frozenAt,eventStart:kickoff,seed,iterations,
  simulate:({random})=>{
   // Template preserves actual observed number and order of regulation drives.
   // Scoring, duration and next field position come from matchup-conditioned
   // authentic drive observations; they are not copied from target outcomes.
   const templates=history.training;
   const t=pick(random,templates,g=>Math.abs((g.homeScore+g.awayScore)-scoredTotal)/42+
    Math.abs((g.homeScore-g.awayScore)-scoredMargin)/36);
   let home=0,away=0,elapsed=0,drives=0,sourceLinks=0;
   let expectedYardsToGoal=null,previousTransition=null,previousExpectedSide=null;
   for(const slot of t.drives){
    if(elapsed>=3600)break;
    const side=slot.offense,team=side==="home"?homeTeamId:awayTeamId;
    const opponent=side==="home"?awayTeamId:homeTeamId;
    const offense=history.offenseSamples.get(team).filter(valid);
    const defense=history.defenseSamples.get(opponent).filter(valid);
    const candidates=random()<.5?offense:defense;
    const quarter=Math.min(4,1+Math.floor(elapsed/900));
    const margin=side==="home"?home-away:away-home;
    const nextSpot=previousExpectedSide===side&&Number.isInteger(expectedYardsToGoal)
      ?expectedYardsToGoal:(Number.isInteger(slot.officialStartYardsToGoal)?
         slot.officialStartYardsToGoal:null);
    const chosen=pick(random,candidates,d=>
     (Number.isInteger(nextSpot)?Math.abs(d.officialStartYardsToGoal-nextSpot)/25:0)+
     Math.abs(d.period-quarter)*.48+
     Math.abs(d.startMargin-margin)/24+
     (previousTransition&&category(previousTransition)!==category(d.startTransition)?1.25:0));
    if(!chosen)throw Error("NFL_TRANSITION_NO_CANDIDATE");
    // Reported TOP is used unchanged, without estimated +25s. If the chosen
    // drive extends beyond regulation time, its points cannot be credited.
    const seconds=chosen.officialDurationSeconds;
    if(elapsed+seconds>3600){elapsed=3600;break}
    elapsed+=seconds;drives++;
    if(side==="home"){home+=chosen.offensePoints;away+=chosen.defensePoints}
    else{away+=chosen.offensePoints;home+=chosen.defensePoints}
    previousTransition=chosen.endTransition;
    previousExpectedSide=mapHistoricalNextOffenseToTarget(chosen,side);
    expectedYardsToGoal=Number.isInteger(chosen.observedNextStartYardsToGoal)?
      chosen.observedNextStartYardsToGoal:null;
    if(previousExpectedSide!==null&&expectedYardsToGoal!==null)sourceLinks++;
   }
   return {metrics:{home_score:home,away_score:away,total:home+away,
    margin:home-away,drives,elapsed_seconds:elapsed,unallocated_seconds:3600-elapsed,
    source_linked_drives:sourceLinks,...outcomeMetrics(home,away)}};
  },
 });
 return {...result,evidenceFingerprint,trainingGames:history.trainingGames,
  trainingDrives:history.trainingDrives,officialDurationDrives:certified.length,
  linkedNextFieldDrives:linked.length,coverage:history.coverage,
  timeEvidence:"NFLFASTR_REPORTED_DRIVE_TIME_OF_POSSESSION",
  fieldTransitionMode:"OBSERVED_NEXT_DRIVE_FIELD_CONDITIONING",
  exclusions:["NO_EXACT_GAMESTATE_SPECIAL_TEAMS_PHYSICS","NO_OT",
   "HISTORICAL_BACKFILL_NOT_PROSPECTIVE","NO_NEW_PROBABILITY_CALIBRATION"],
  calibrationStatus:"NOT_VALIDATED",canQualify:false,
  canAuthorizeWager:false,changesProductionChampion:false};
}
