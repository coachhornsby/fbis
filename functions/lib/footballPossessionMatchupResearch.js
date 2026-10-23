/**
 * Point-in-time empirical possession matchup challenger (NFL / CFB).
 * Research-only. Does not change the v1 NFL, v2 CFB or wagering engines.
 * NFL possession input must come from a verified, immutable PBP-derived
 * game artifact; no possession or game clock is reconstructed here.
 */
import {sha256Hex} from "./sha256Hex.js";
import {runSportSimulationResearch} from "./sportSimulationResearch.js";
import {outcomeMetrics} from "./footballSimulationRankings.js";

export const MATCHUP_DRIVE_IDS=Object.freeze({
 nfl:"NFL-VERIFIED-POSSESSION-MATCHUP-SHADOW-v0",
 cfb:"CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0",
});
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const stamp=x=>typeof x==="string"&&x.trim()?Date.parse(x):NaN;
const validId=x=>typeof x==="string"&&/^[A-Za-z0-9:._-]{1,100}$/.test(x);
function requireThat(ok,reason){if(!ok)throw Error(reason)}
function seedFor(x){let h=2166136261;for(const c of String(x))h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)||1}
function fingerprint(x){return sha256Hex(JSON.stringify(x))}
function weighted(random,items,weight){
 let total=0;const cumulative=[];
 for(const row of items){total+=Math.max(1e-8,weight(row));cumulative.push(total)}
 const v=random()*total;let lo=0,hi=items.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(cumulative[mid]<v)lo=mid+1;else hi=mid}
 return items[lo];
}
/**
 * Strict adapter for one pre-reconciled NFL regulation possession dataset.
 * The adapter will not infer PBP drive boundaries, scoring or overtime.
 * Each row requires complete pre/post scores and chronological possession index.
 */
export function normalizeVerifiedNflPossessions({
 gameId,homeTeamId,awayTeamId,kickoff,gradedAt,observedAt,
 homeScore,awayScore,sourceArtifactHash,regulationOnly,wasOvertime,
 drives=[]
}={}){
 requireThat(validId(gameId)&&validId(homeTeamId)&&validId(awayTeamId)&&homeTeamId!==awayTeamId,"NFL_IDENTITY_MISSING");
 requireThat(regulationOnly===true&&wasOvertime===false,"NFL_REGULATION_SCOPE_NOT_VERIFIED");
 requireThat(/^[a-f0-9]{64}$/i.test(String(sourceArtifactHash||"")),"NFL_IMMUTABLE_SOURCE_REQUIRED");
 const times=[stamp(kickoff),stamp(gradedAt),stamp(observedAt)];
 requireThat(times.every(Number.isFinite)&&times[0]<times[1]&&times[1]<=times[2],"NFL_SOURCE_TIMELINE_INVALID");
 requireThat([homeScore,awayScore].every(x=>Number.isInteger(x)&&x>=0&&x<=100),"NFL_OFFICIAL_REGULATION_SCORE_MISSING");
 requireThat(Array.isArray(drives)&&drives.length>=16&&drives.length<=44,"NFL_DRIVE_COMPLETENESS_INVALID");
 const sorted=[...drives].sort((a,b)=>a.seq-b.seq),seen=new Set(),normalized=[];
 let h=0,a=0,homeDrives=0,awayDrives=0;
 for(let i=0;i<sorted.length;i++){
  const d=sorted[i],side=d.offenseTeamId===homeTeamId?"home":d.offenseTeamId===awayTeamId?"away":null;
  requireThat(side&&validId(String(d.driveId||""))&&!seen.has(d.driveId)&&d.seq===i+1,"NFL_DRIVE_IDENTITY_OR_ORDER_INVALID");
  seen.add(d.driveId);
  requireThat(Number.isInteger(d.period)&&d.period>=1&&d.period<=4&&Number.isInteger(d.plays)&&d.plays>=1&&d.plays<=35&&
    Number.isInteger(d.startYardsToGoal)&&d.startYardsToGoal>=0&&d.startYardsToGoal<=100,
    "NFL_DRIVE_CONTEXT_MISSING");
  requireThat([d.startHomeScore,d.startAwayScore,d.endHomeScore,d.endAwayScore].every(x=>Number.isInteger(x)&&x>=0&&x<=100),
    "NFL_DRIVE_SCORE_MISSING");
  requireThat(d.startHomeScore===h&&d.startAwayScore===a&&d.endHomeScore>=h&&d.endAwayScore>=a,
    "NFL_DRIVE_SCORE_DISCONTINUITY");
  const offPoints=side==="home"?d.endHomeScore-h:d.endAwayScore-a;
  const defPoints=side==="home"?d.endAwayScore-a:d.endHomeScore-h;
  requireThat(offPoints<=8&&defPoints<=8&&!(offPoints&&defPoints),"NFL_DRIVE_SCORE_UNSUPPORTED");
  normalized.push({driveId:d.driveId,seq:d.seq,offense:side,period:d.period,plays:d.plays,
   startYardsToGoal:d.startYardsToGoal,startMargin:side==="home"?h-a:a-h,
   offensePoints:offPoints,defensePoints:defPoints});
  h=d.endHomeScore;a=d.endAwayScore;
  if(side==="home")homeDrives++;else awayDrives++;
 }
 requireThat(h===homeScore&&a===awayScore&&homeDrives>=8&&awayDrives>=8,
  "NFL_OFFICIAL_SCORE_OR_SIDE_COVERAGE_MISMATCH");
 const sourceFingerprint=fingerprint({gameId,homeTeamId,awayTeamId,kickoff,gradedAt,
   observedAt,sourceArtifactHash,homeScore,awayScore,normalized});
 return {gameId,homeTeamId,awayTeamId,kickoff,gradedAt,observedAt,
  source:"NFL_PBP_VERIFIED_POSSESSIONS",sourceArtifactHash,sourceFingerprint,
  regulationOnly:true,officialScoreMatched:true,
  homeScore,awayScore,drives:normalized};
}
export function selectMatchupDriveHistory(games,{
 sport,targetGameId,frozenAt,homeTeamId,awayTeamId,minTeamDrives=24,minTeamGames=3,
  historicalReconstruction=false,
}={}){
 requireThat(MATCHUP_DRIVE_IDS[sport]&&validId(targetGameId)&&validId(homeTeamId)&&validId(awayTeamId)
   &&homeTeamId!==awayTeamId&&Number.isFinite(stamp(frozenAt)),"MATCHUP_CONTEXT_INVALID");
 const map=new Map(),excluded={},sources=sport==="nfl"?
   ["NFL_PBP_VERIFIED_POSSESSIONS"]:["CFBD_DRIVES","SDV_ESPN_CFB_PBP_DRIVES"];
 const mark=k=>excluded[k]=(excluded[k]||0)+1;
 for(const g of games||[]){
  let reason=null;
  if(g?.gameId===targetGameId)reason="TARGET_GAME";
  else if(!sources.includes(g?.source)||g.regulationOnly!==true||g.officialScoreMatched!==true||
     !validId(g.homeTeamId)||!validId(g.awayTeamId)||g.homeTeamId===g.awayTeamId||
     !validId(g.sourceFingerprint)||!Array.isArray(g.drives)||g.drives.length<12)reason="UNVERIFIED_SOURCE_OR_TEAM";
  else if(![stamp(g.kickoff),stamp(g.gradedAt),stamp(g.observedAt)].every(Number.isFinite)||
     !(stamp(g.kickoff)<=stamp(g.gradedAt)&&stamp(g.gradedAt)<=stamp(g.observedAt)&&
       (historicalReconstruction?stamp(g.kickoff)<stamp(frozenAt):stamp(g.observedAt)<stamp(frozenAt))))
     reason="FUTURE_OR_MISSING_SOURCE_TIME";
  else if(g.drives.some(d=>!["home","away"].includes(d.offense)||
     !Number.isInteger(d.period)||d.period<1||d.period>4||
     !Number.isInteger(d.startYardsToGoal)||d.startYardsToGoal<0||d.startYardsToGoal>100||
     !Number.isInteger(d.offensePoints)||d.offensePoints<0||d.offensePoints>8||
     !Number.isInteger(d.defensePoints)||d.defensePoints<0||d.defensePoints>8||
     (d.offensePoints>0&&d.defensePoints>0)))reason="INVALID_POSSESSION_CONTEXT";
  if(reason){mark(reason);continue}
  const old=map.get(g.gameId);
  if(!old||stamp(g.observedAt)>stamp(old.observedAt))map.set(g.gameId,g);
 }
 const pool=[...map.values()].sort((a,b)=>stamp(b.kickoff)-stamp(a.kickoff)).slice(0,sport==="cfb"?700:350);
 const off=new Map(),allow=new Map(),gamesByTeam=new Map(),perGame=new Map();
 const add=(map,key,row)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(row)};
 for(const g of pool){
  const driveCount={[g.homeTeamId]:0,[g.awayTeamId]:0};
  for(const d of g.drives){
   const attacker=d.offense==="home"?g.homeTeamId:g.awayTeamId;
   const defender=d.offense==="home"?g.awayTeamId:g.homeTeamId;
   add(off,attacker,d);add(allow,defender,d);driveCount[attacker]++;
  }
  for(const team of [g.homeTeamId,g.awayTeamId]){
   if(!gamesByTeam.has(team))gamesByTeam.set(team,new Set());
   gamesByTeam.get(team).add(g.gameId);
   add(perGame,team,driveCount[team]);
  }
 }
 const keys=[homeTeamId,awayTeamId];
 const coverage=Object.fromEntries(keys.map(k=>[k,{
   games:gamesByTeam.get(k)?.size||0,
   offenseDrives:off.get(k)?.length||0,
   defenseDrives:allow.get(k)?.length||0,
   meanPace:(perGame.get(k)||[]).reduce((n,x)=>n+x,0)/Math.max(1,(perGame.get(k)||[]).length),
 }]));
 const eligible=pool.length>=20&&pool.reduce((n,g)=>n+g.drives.length,0)>=300&&
  keys.every(k=>coverage[k].games>=minTeamGames&&coverage[k].offenseDrives>=minTeamDrives&&
   coverage[k].defenseDrives>=minTeamDrives);
 return {sport,frozenAt,eligible,
  evidenceMode:historicalReconstruction?"POSTGAME_RECONSTRUCTED_BACKTEST":"STRICT_POINT_IN_TIME",
  trainingGames:pool.length,
  trainingDrives:pool.reduce((n,g)=>n+g.drives.length,0),coverage,excluded,
  sourceFingerprint:fingerprint(pool.map(g=>g.sourceFingerprint).sort()),
  // Internal research samples. Callers must not serialize these raw records to public responses.
  training:pool,offenseSamples:off,defenseSamples:allow};
}
export function simulateMatchupDriveShadow({
 sport,gameId,snapshotId,frozenAt,kickoff,homeTeamId,awayTeamId,
 projectedHome,projectedAway,trainingGames=[],iterations=1000,
 historicalReconstruction=false,
}={}){
 requireThat(MATCHUP_DRIVE_IDS[sport]&&validId(gameId)&&validId(snapshotId)&&
   Number.isFinite(stamp(frozenAt))&&stamp(frozenAt)<stamp(kickoff)&&
   [projectedHome,projectedAway].every(x=>finite(x)&&x>=0&&x<=90)&&
   Number.isInteger(iterations)&&iterations>=100&&iterations<=5000,"INVALID_MATCHUP_RESEARCH_BASELINE");
 const history=selectMatchupDriveHistory(trainingGames,{
  sport,targetGameId:gameId,frozenAt,homeTeamId,awayTeamId,historicalReconstruction,
 });
 requireThat(history.eligible,"INSUFFICIENT_MATCHUP_TEAM_DRIVE_HISTORY");
 const ids=[homeTeamId,awayTeamId],pace=ids.map(id=>history.coverage[id].meanPace);
 const expectedMargin=projectedHome-projectedAway,expectedTotal=projectedHome+projectedAway;
 const seed=seedFor([MATCHUP_DRIVE_IDS[sport],gameId,snapshotId,frozenAt,
  history.sourceFingerprint,homeTeamId,awayTeamId].join("|"));
 const output=runSportSimulationResearch({
  sport,eventId:gameId,modelId:MATCHUP_DRIVE_IDS[sport],modelVersion:"0.1.0",
  publishedAt:frozenAt,eventStart:kickoff,seed,iterations,
  simulate:({random})=>{
   const template=weighted(random,history.training,g=>{
    const countSide=side=>g.drives.filter(d=>d.offense===side).length;
    const scoredHome=g.homeScore??g.projectedHome??0,scoredAway=g.awayScore??g.projectedAway??0;
    return Math.exp(-Math.abs(countSide("home")-pace[0])/4-Math.abs(countSide("away")-pace[1])/4-
     Math.abs(scoredHome+scoredAway-expectedTotal)/45-
     Math.abs(scoredHome-scoredAway-expectedMargin)/35);
   });
   let home=0,away=0,homeDrives=0,awayDrives=0;
   for(const spot of template.drives){
    const side=spot.offense,team=side==="home"?homeTeamId:awayTeamId;
    const opp=side==="home"?awayTeamId:homeTeamId;
    // Each simulated drive draws from team's historical offense and the
    // opponent's historical allowed drives; not location labels or model odds.
    const off=history.offenseSamples.get(team),def=history.defenseSamples.get(opp);
    const candidates=random()<0.5?off:def;
    const margin=side==="home"?home-away:away-home;
    let chosen=candidates[Math.floor(random()*candidates.length)],best=-Infinity;
    for(let n=0;n<24;n++){
     const d=candidates[Math.floor(random()*candidates.length)];
     const mismatch=Math.abs(d.startYardsToGoal-spot.startYardsToGoal)/30+
       Math.abs(d.period-spot.period)*0.6+Math.abs(d.startMargin-margin)/20;
     const merit=-mismatch+Math.log(Math.max(random(),1e-12))*0.35;
     if(merit>best){best=merit;chosen=d}
    }
    if(side==="home"){home+=chosen.offensePoints;away+=chosen.defensePoints;homeDrives++}
    else{away+=chosen.offensePoints;home+=chosen.defensePoints;awayDrives++}
   }
   return {metrics:{home_score:home,away_score:away,total:home+away,margin:home-away,
    home_drives:homeDrives,away_drives:awayDrives,...outcomeMetrics(home,away)}};
  }
 });
 return {...output,sourceDb:sport==="nfl"?"NFL_DB":"CFB_DB",
  matchupTeams:{home:homeTeamId,away:awayTeamId},coverage:history.coverage,
  evidenceFingerprint:history.sourceFingerprint,trainingGames:history.trainingGames,
  trainingDrives:history.trainingDrives,method:"EMPIRICAL_OFFENSE_OPPONENT_ALLOWED_DRIVE_RESAMPLING",
  dataAccess:historicalReconstruction?"HISTORICAL_RECONSTRUCTED_NOT_PROSPECTIVE":"VERIFIED_POINT_IN_TIME_HISTORY_ONLY",
  calibrationStatus:"NOT_VALIDATED",
  marketScope:"REGULATION_ONLY",overtimeMode:"NOT_MODELED",
  canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
