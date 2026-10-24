/**
 * Real historical possession readiness for FUTURE NBA/CBB research forecasts.
 * It measures source coverage, not predictive accuracy or pregame backtests.
 */
import {BASKETBALL_POSSESSION_RESEARCH,validateBasketballPossessionGame}
 from "./basketballSdvPossessionSimulationResearch.js";
const ms=x=>typeof x==="string"?Date.parse(x):NaN;
export function createBasketballHistoricalReadiness({
 sport,targetSeason,asOf
}={}){
 const cfg=BASKETBALL_POSSESSION_RESEARCH[sport];
 if(!cfg||!Number.isInteger(targetSeason)||targetSeason<2010||targetSeason>2100||
   !Number.isFinite(ms(asOf)))
  throw Error("BASKETBALL_HISTORY_READINESS_SCOPE_INVALID");
 const teams=new Map(),ids=new Set(),physical=new Set();
 const excluded={futureObserved:0,lateTipoff:0};
 let acceptedGames=0,acceptedPossessions=0,earliest=Infinity,latest=-Infinity;
 function ensure(id){
  if(!teams.has(id))teams.set(id,{teamId:id,games:0,currentSeasonGames:0,
   offensivePossessions:0,defensivePossessions:0,
   lastGameTipoff:null,earliestObservedAt:null,latestObservedAt:null});
  return teams.get(id);
 }
 function accept(raw){
  const g=validateBasketballPossessionGame(raw);
  if(g.sport!==sport)throw Error("BASKETBALL_HISTORY_SPORT_MISMATCH");
  if(ids.has(g.gameId))throw Error("BASKETBALL_HISTORY_DUPLICATE_GAME_ID");
  ids.add(g.gameId);
  if(ms(g.observedAt)>ms(asOf)){excluded.futureObserved++;return false}
  if(ms(g.tipoff)>=ms(asOf)){excluded.lateTipoff++;return false}
  const physicalId=[g.homeTeamId,g.awayTeamId,g.tipoff].join("|");
  if(physical.has(physicalId))throw Error("BASKETBALL_HISTORY_DUPLICATE_PHYSICAL_GAME");
  physical.add(physicalId);
  acceptedGames++;acceptedPossessions+=g.possessions.length;
  earliest=Math.min(earliest,ms(g.observedAt));
  latest=Math.max(latest,ms(g.observedAt));
  for(const side of ["home","away"]){
   const tid=g[side+"TeamId"],other=side==="home"?"away":"home";
   const x=ensure(tid);x.games++;
   if(g.season===targetSeason)x.currentSeasonGames++;
   x.offensivePossessions+=g[side+"Possessions"];
   x.defensivePossessions+=g[other+"Possessions"];
   x.lastGameTipoff=!x.lastGameTipoff||ms(g.tipoff)>ms(x.lastGameTipoff)?
    g.tipoff:x.lastGameTipoff;
   x.earliestObservedAt=!x.earliestObservedAt||
    ms(g.observedAt)<ms(x.earliestObservedAt)?g.observedAt:x.earliestObservedAt;
   x.latestObservedAt=!x.latestObservedAt||
    ms(g.observedAt)>ms(x.latestObservedAt)?g.observedAt:x.latestObservedAt;
  }
  return true;
 }
 function summary(){
  const members=[...teams.values()].sort((a,b)=>a.teamId.localeCompare(b.teamId));
  const cohort=members.map(t=>({...t,historyReady:
    t.games>=cfg.minTeamGames&&
    (sport!=="cbb"||t.currentSeasonGames>=cfg.minCurrentSeasonGames)}));
  const qualified=cohort.filter(t=>t.historyReady);
  return{sport,targetSeason,asOf,
   modelId:cfg.id,source:"VERIFIED_SDV_NBA_CBB_POSSESSION_RELEASES",
   observedSourceAfterAcquisition:true,acceptedGames,acceptedPossessions,
   distinctTeams:members.length,
   historyReadyTeams:qualified.length,
   unreadyTeams:members.length-qualified.length,
   minimumTeamGames:cfg.minTeamGames,
   minimumCurrentSeasonGames:sport==="cbb"?cfg.minCurrentSeasonGames:0,
   sourceFirstObservedAt:earliest===Infinity?null:new Date(earliest).toISOString(),
   sourceLatestObservedAt:latest===-Infinity?null:new Date(latest).toISOString(),
   excluded,teams:cohort,sourceValidated:true,
   historicalPregameForecasts:0,
   gradedProspectiveGames:0,prospectiveValidated:false,
   calibrated:false,canQualify:false,canAuthorizeWager:false,
   changesProductionChampion:false};
 }
 return{accept,summary};
}
