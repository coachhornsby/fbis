/**
 * Genuine NFL game-path Monte Carlo challenger, independent of the existing
 * Gaussian pHomeWin. Each iteration plays a full 60-minute regulation sequence
 * of possession outcomes, using only an authentic frozen FBIS scoring baseline.
 *
 * IMPORTANT: Possessions and outcome priors are explicitly PARAMETRIC until
 * individually time-stamped NFL drive source histories are available.
 * This is NOT a trained/validated NFL PBP engine or wager probability.
 */
import {runSportSimulationResearch} from "./sportSimulationResearch.js";
import {outcomeMetrics} from "./footballSimulationRankings.js";
export const NFL_FULL_GAME_RESEARCH_MODEL="NFL-DRIVE-MC-SHADOW-v1";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const bounded=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
function seedFor(input){
 let x=2166136261;for(const ch of String(input))x=Math.imul(x^ch.charCodeAt(0),16777619);
 return (x>>>0)||1;
}
function outcomeRates(averagePoints,possessions){
 // Structural prior: 16% FG and TD rate determined by expected points.
 // Published FBIS score is the sole team-specific center; no fabricated PBP.
 const fg=.16;
 const td=bounded((averagePoints/possessions-3*fg)/7,.01,.67);
 return {fg,td,empty:1-fg-td};
}
export function simulateNflFullGameResearch({
 gameId,kickoff,sourceFrozenAt,projectedHome,projectedAway,
 iterations=5000,modelVersion="v1.2",paceHome=null,paceAway=null,
}={}){
 if(!gameId||!Number.isFinite(Date.parse(kickoff))||
    !Number.isFinite(Date.parse(sourceFrozenAt))||
    Date.parse(sourceFrozenAt)>=Date.parse(kickoff)||
    ![projectedHome,projectedAway].every(x=>finite(x)&&x>=3&&x<=65))
   throw Error("INVALID_NFL_FROZEN_PREGAME_BASELINE");
 if(!Number.isInteger(iterations)||iterations<500||iterations>5000)
   throw Error("INVALID_NFL_SIMULATION_ITERATIONS");
 // Four quarters, roughly 11 possessions per team. Same match tempo draw
 // affects both offenses, unlike two independent final-score normals.
 const impliedPoss=11;
 const hDr=finite(paceHome)?bounded(paceHome,8,15):impliedPoss;
 const aDr=finite(paceAway)?bounded(paceAway,8,15):impliedPoss;
 const scoreCenterHome=projectedHome,scoreCenterAway=projectedAway;
 const seed=seedFor([gameId,sourceFrozenAt,projectedHome,projectedAway,
   NFL_FULL_GAME_RESEARCH_MODEL,iterations].join("|"));
 const output=runSportSimulationResearch({
  sport:"nfl",eventId:String(gameId),modelId:NFL_FULL_GAME_RESEARCH_MODEL,
  modelVersion:"1.0.0",publishedAt:sourceFrozenAt,eventStart:kickoff,
  iterations,seed,
  simulate:({random})=>{
   const matchPace=bounded(Math.round((hDr+aDr)/2+(random()+random()+random()-1.5)*4),8,15);
   const homeP=bounded(matchPace+Math.round(hDr-aDr),8,15);
   const awayP=bounded(matchPace+Math.round(aDr-hDr),8,15);
   const hRate=outcomeRates(scoreCenterHome,homeP);
   const aRate=outcomeRates(scoreCenterAway,awayP);
   let h=0,a=0,hDrive=0,aDrive=0,tdH=0,tdA=0,fgH=0,fgA=0;
   // Interleaved possessions make score-state and phase available for each
   // drive, allowing underdog urgency/lead protection while retaining the
   // same score and winning-event sample.
   for(let step=0;step<Math.max(homeP,awayP)*2;step++){
    const side=step%2===0?"home":"away";
    if(side==="home"&&hDrive>=homeP||side==="away"&&aDrive>=awayP)continue;
    const isH=side==="home";if(isH)hDrive++;else aDrive++;
    const r=isH?hRate:aRate;
    const remaining=1-step/(Math.max(homeP,awayP)*2);
    const behind=isH?a-h:h-a;
    const lateUrgency=remaining<.3&&behind>7?0.035:0;
    const protect=remaining<.3&&behind< -10?-.025:0;
    // Shared field-position variation is sampled on every drive. It does
    // not claim that an actual yard line was observed in source data.
    const fieldPosition=(random()+random()-1)*.11;
    const pTd=bounded(r.td+lateUrgency+protect+fieldPosition,.005,.82);
    const pFg=bounded(r.fg+(fieldPosition*0.26),.01,.25);
    const draw=random();
    const points=draw<pTd?7:draw<pTd+pFg?3:0;
    if(isH){h+=points;if(points===7)tdH++;else if(points===3)fgH++;}
    else {a+=points;if(points===7)tdA++;else if(points===3)fgA++;}
   }
   return {metrics:{home_score:h,away_score:a,total:h+a,margin:h-a,
     home_drives:hDrive,away_drives:aDrive,home_td_drives:tdH,away_td_drives:tdA,
     home_fg_drives:fgH,away_fg_drives:fgA,...outcomeMetrics(h,a)}};
  }
 });
 return {...output,baselineModelVersion:modelVersion,sourceFrozenAt,
  prior:"UNVALIDATED_11_POSSESSIONS_16_PERCENT_FG",
  paceSource:finite(paceHome)&&finite(paceAway)?"PUBLISHED_TEAM_PACE":"EXPLICIT_LEAGUE_PRIOR",
  method:"DRIVE_BY_DRIVE_60_MIN_REGULATION_MONTE_CARLO",
  calibrationStatus:"NOT_VALIDATED",probabilitiesMarketQualified:false,
  marketScope:"REGULATION_ONLY",overtimeMode:"NOT_MODELED",
  canAuthorizeWager:false,canQualify:false,changesProductionChampion:false};
}
