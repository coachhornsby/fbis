/**
 * CFB drive-level research challenger v2.
 * Uses actual CFBD /drives observations with immutable collection clocks.
 * Simulates possession outcomes and score evolution; never invents PBP,
 * field position, player stats, or a market-eligible moneyline.
 */
import { sha256Hex } from "./sha256Hex.js";
import { runSportSimulationResearch } from "./sportSimulationResearch.js";
import {outcomeMetrics} from "./footballSimulationRankings.js";

export const CFB_DRIVE_SIM_ID = "CFB-DRIVE-STATE-SHADOW-v2";
export const CFB_DRIVE_MIN_GAMES = 20;
export const CFB_DRIVE_MIN_DRIVES = 300;
const finite=v=>typeof v==="number"&&Number.isFinite(v);
const clock=v=>typeof v==="string"&&v.trim()?Date.parse(v):NaN;
function must(value,reason){if(!value)throw new Error(reason);}
function int(v,lo,hi){return Number.isInteger(v)&&v>=lo&&v<=hi;}
function seedFrom(v){let n=2166136261;for(const ch of String(v)){n=Math.imul(n^ch.charCodeAt(0),16777619)}return(n>>>0)||1;}
const side=(isHome)=>isHome?"home":"away";

/** One immutable, complete, officially reconciled non-overtime drive game. */
export function normalizeCfbdDriveGame({
 gameId,drives,homeScore,awayScore,kickoff,gradedAt,observedAt,
 projectedHome,projectedAway,modelVersion="CFB-FBIS-v2",
}={}){
 must(/^[a-zA-Z0-9:._-]{1,80}$/.test(String(gameId||"")),"INVALID_CFB_GAME_ID");
 must([homeScore,awayScore,projectedHome,projectedAway].every(v=>finite(v)&&v>=0),"INVALID_OFFICIAL_SCORES_OR_BASELINE");
 const t=clock(kickoff),g=clock(gradedAt),o=clock(observedAt);
 must([t,g,o].every(Number.isFinite)&&t<=g&&g<=o,"INVALID_DRIVE_SOURCE_TIMELINE");
 must(modelVersion==="CFB-FBIS-v2","UNSUPPORTED_CFB_DRIVE_BASELINE");
 must(Array.isArray(drives)&&drives.length>=12&&drives.length<=70,"INVALID_DRIVE_COMPLETENESS");
 const sorted=[...drives].sort((a,b)=>a.driveNumber-b.driveNumber);
 const seen=new Set();
 let cumulativeHome=0,cumulativeAway=0;
 const normalized=[];
 for(const d of sorted){
   must(String(d.gameId)===String(gameId)&&String(d.id||"").trim(),"DRIVE_GAME_ID_MISMATCH");
   must(int(d.driveNumber,1,150)&&!seen.has(d.id),"DUPLICATE_OR_UNKNOWN_DRIVE");
   seen.add(d.id);
   must(typeof d.isHomeOffense==="boolean","UNKNOWN_DRIVE_TEAM");
   must(int(d.startPeriod,1,4)&&int(d.endPeriod,1,4)&&d.endPeriod>=d.startPeriod,"UNSUPPORTED_CFB_OVERTIME");
   must(int(d.startYardsToGoal,0,100)&&int(d.plays,0,35),"INVALID_FIELD_POSITION_OR_PLAYS");
   const scores=[d.startOffenseScore,d.startDefenseScore,d.endOffenseScore,d.endDefenseScore];
   must(scores.every(v=>int(v,0,200)),"INVALID_DRIVE_SCORE_PROVENANCE");
   const h0=d.isHomeOffense?d.startOffenseScore:d.startDefenseScore;
   const a0=d.isHomeOffense?d.startDefenseScore:d.startOffenseScore;
   const h1=d.isHomeOffense?d.endOffenseScore:d.endDefenseScore;
   const a1=d.isHomeOffense?d.endDefenseScore:d.endOffenseScore;
   must(h0===cumulativeHome&&a0===cumulativeAway,"DRIVE_SCORE_CONTINUITY_GAP");
   must(h1>=h0&&a1>=a0,"DRIVE_SCORE_REGRESSION");
   const offPoints=d.endOffenseScore-d.startOffenseScore;
   const defPoints=d.endDefenseScore-d.startDefenseScore;
   must(int(offPoints,0,8)&&int(defPoints,0,8)&&!(offPoints>0&&defPoints>0),"UNSUPPORTED_DRIVE_SCORE_DELTA");
   cumulativeHome=h1;cumulativeAway=a1;
   normalized.push({
     driveId:String(d.id),seq:d.driveNumber,offense:side(d.isHomeOffense),
     startYardsToGoal:d.startYardsToGoal,period:d.startPeriod,plays:d.plays,
     startMargin:d.startOffenseScore-d.startDefenseScore,
     offensePoints:offPoints,defensePoints:defPoints,
     driveResult:String(d.driveResult||"UNKNOWN").slice(0,80),
   });
 }
 must(cumulativeHome===homeScore&&cumulativeAway===awayScore,"DRIVE_FINAL_SCORE_MISMATCH");
 must(normalized.filter(d=>d.offense==="home").length>=4&&normalized.filter(d=>d.offense==="away").length>=4,"DRIVE_SIDE_COVERAGE_INCOMPLETE");
 const fingerprint=sha256Hex(JSON.stringify({gameId,normalized,homeScore,awayScore,kickoff,gradedAt}));
 return {gameId:String(gameId),kickoff,gradedAt,observedAt,
   projectedHome,projectedAway,modelVersion,homeScore,awayScore,
   drives:normalized,source:"CFBD_DRIVES",sourceFingerprint:fingerprint,
   regulationOnly:true,officialScoreMatched:true,
 };
}
/** Independent point-in-time source availability, not just event chronology. */
export function selectCfbDriveTraining(games,{targetGameId,frozenAt}={}){
 const cutoff=clock(frozenAt);
 must(Number.isFinite(cutoff)&&String(targetGameId||"").trim(),"INVALID_TARGET_CLOCK");
 const selected=new Map(),reasons={};
 for(const g of games||[]){
  let reason=null;
  if(g?.gameId===String(targetGameId))reason="TARGET_GAME";
  else if(!g?.officialScoreMatched||g?.regulationOnly!==true||g?.source!=="CFBD_DRIVES"||
   !Array.isArray(g?.drives)||g.drives.length<12)reason="UNVERIFIED_DRIVES";
  else if(![clock(g.kickoff),clock(g.gradedAt),clock(g.observedAt)].every(Number.isFinite))reason="MISSING_TIME";
  else if(!(clock(g.kickoff)<=clock(g.gradedAt)&&clock(g.gradedAt)<=clock(g.observedAt)&&
             clock(g.observedAt)<cutoff))reason="FUTURE_TRAINING_DATA";
  else if(![g.projectedHome,g.projectedAway].every(finite)||g.modelVersion!=="CFB-FBIS-v2")reason="UNMATCHED_MODEL";
  if(reason){reasons[reason]=(reasons[reason]||0)+1;continue;}
  const prior=selected.get(g.gameId);
  if(!prior||clock(g.observedAt)>clock(prior.observedAt))selected.set(g.gameId,g);
 }
 const pool=[...selected.values()].sort((a,b)=>clock(b.kickoff)-clock(a.kickoff)).slice(0,350);
 return {games:pool,driveCount:pool.reduce((n,g)=>n+g.drives.length,0),reasons,
    eligible:pool.length>=CFB_DRIVE_MIN_GAMES &&
      pool.reduce((n,g)=>n+g.drives.length,0)>=CFB_DRIVE_MIN_DRIVES};
}
function chooseWeighted(random,items,weight){
 let sum=0;
 const pick=items.map(item=>{sum+=weight(item);return sum});
 const x=random()*sum;
 let low=0,high=pick.length-1;
 while(low<high){const mid=(low+high)>>1;if(pick[mid]<x)low=mid+1;else high=mid}
 return items[low];
}
export function simulateCfbDriveShadowV2({
 gameId,snapshotId,frozenAt,kickoff,projectedHome,projectedAway,
 trainingGames=[],iterations=1000,
}={}){
 must(String(snapshotId||"").trim()&&String(gameId||"").trim(),"MISSING_SNAPSHOT_IDENTITY");
 must(Number.isFinite(clock(frozenAt))&&Number.isFinite(clock(kickoff))&&clock(frozenAt)<clock(kickoff),"NOT_FROZEN_PREGAME");
 must([projectedHome,projectedAway].every(v=>finite(v)&&v>=0),"INVALID_FROZEN_BASELINE");
 const training=selectCfbDriveTraining(trainingGames,{targetGameId:String(gameId),frozenAt});
 must(training.eligible,"INSUFFICIENT_VERIFIED_CFB_DRIVE_HISTORY");
 const pool=training.games;
 const fingerprints=pool.map(g=>g.sourceFingerprint).sort().join("|");
 const evidenceHash=sha256Hex(fingerprints);
 const seed=seedFrom([gameId,snapshotId,CFB_DRIVE_SIM_ID,evidenceHash].join("|"));
 const baselineMargin=projectedHome-projectedAway,baselineTotal=projectedHome+projectedAway;
 const bySide={
  home:pool.flatMap(g=>g.drives.filter(d=>d.offense==="home")),
  away:pool.flatMap(g=>g.drives.filter(d=>d.offense==="away")),
 };
 must(bySide.home.length>=100&&bySide.away.length>=100,"INSUFFICIENT_SIDE_DRIVES");
 const output=runSportSimulationResearch({
  sport:"cfb",eventId:String(gameId),modelId:CFB_DRIVE_SIM_ID,modelVersion:"2.0.0",
  publishedAt:frozenAt,eventStart:kickoff,seed,iterations,
  simulate:({random})=>{
   const template=chooseWeighted(random,pool,g=>0.25+0.75*Math.exp(
    -Math.abs(g.projectedHome+g.projectedAway-baselineTotal)/30-
     Math.abs(g.projectedHome-g.projectedAway-baselineMargin)/28));
   let h=0,a=0,hTd=0,aTd=0,hFg=0,aFg=0,hDr=0,aDr=0;
   for(const spot of template.drives){
    const candidates=bySide[spot.offense];
    const margin=spot.offense==="home"?h-a:a-h;
    // Twenty candidate local neighbor search controls CPU while conditioning
    // on *simulated* scoreboard, quarter, and observed field-position context.
    let best=candidates[Math.floor(random()*candidates.length)];
    let bestScore=-Infinity;
    for(let j=0;j<20;j++){
      const d=candidates[Math.floor(random()*candidates.length)];
      const distance=Math.abs(d.startYardsToGoal-spot.startYardsToGoal)/30+
        Math.abs(d.period-spot.period)*0.6+Math.abs(d.startMargin-margin)/18;
      const score=-distance+Math.log(Math.max(1e-9,random()))*0.4;
      if(score>bestScore){bestScore=score;best=d;}
    }
    if(spot.offense==="home"){
      h+=best.offensePoints;a+=best.defensePoints;hDr++;
      if(best.offensePoints>=6)hTd++;
      else if(best.offensePoints===3)hFg++;
    }else{
      a+=best.offensePoints;h+=best.defensePoints;aDr++;
      if(best.offensePoints>=6)aTd++;
      else if(best.offensePoints===3)aFg++;
    }
   }
   return {metrics:{home_score:h,away_score:a,total:h+a,margin:h-a,
     home_drives:hDr,away_drives:aDr,home_touchdown_drives:hTd,
     away_touchdown_drives:aTd,home_field_goal_drives:hFg,
     away_field_goal_drives:aFg,...outcomeMetrics(h,a)}};
  }
 });
 return {...output,sourceDb:"CFB_DB",sourceSnapshotId:snapshotId,
   evidenceFingerprint:evidenceHash,trainingGames:pool.length,
   trainingDrives:training.driveCount,trainingCutoff:frozenAt,
   algorithm:"CONTEXT_CONDITIONED_EMPIRICAL_DRIVE_RESAMPLING",
   marketScope:"REGULATION_ONLY",ncaOvertimeMode:"NOT_MODELED",
   playerStatsMode:"NOT_MODELED",marketProbabilitiesQualified:false,
   canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
