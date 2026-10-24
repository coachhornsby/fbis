/** Read-only NFL/CFB prospective readiness and source latency audit. */
const ms=x=>typeof x==="string"?Date.parse(x):NaN;
export function summarizeFootballProspectiveReadiness(rows,{
 sport,asOf,sourceLatestObservedAt=null,minElapsedHours=4
}={}){
 if(!["nfl","cfb"].includes(sport)||!Number.isFinite(ms(asOf))||
  !Number.isFinite(minElapsedHours)||minElapsedHours<1||minElapsedHours>72||
  !Array.isArray(rows)||rows.length>10000)throw Error("INVALID_PROSPECTIVE_READINESS_SCOPE");
 const now=ms(asOf),latest=ms(sourceLatestObservedAt);
 const group={},physical=new Set(),latePhysical=new Set(),ungradedPhysical=new Set();
 const exclude={};const mark=x=>exclude[x]=(exclude[x]||0)+1;
 for(const r of rows){
  if(r.sport!==sport||typeof r.modelId!=="string"||!r.modelId||
   typeof r.gameId!=="string"||!r.gameId||
   typeof r.homeTeamId!=="string"||typeof r.awayTeamId!=="string"||
   !Number.isFinite(ms(r.capturedAt))||!Number.isFinite(ms(r.kickoff))||
   ms(r.capturedAt)>=ms(r.kickoff)){mark("INVALID_PREGAME_RECEIPT");continue}
  const key=[r.homeTeamId,r.awayTeamId,ms(r.kickoff)].join("|");
  physical.add(key);
  const rec=group[r.modelId]??={receipts:0,future:0,inProgressOrRecentlyFinished:0,
   overdueWithoutVerifiedGrade:0,graded:0,distinctGames:0,earliestKickoff:null,latestKickoff:null};
  rec.receipts++;
  rec.earliestKickoff=!rec.earliestKickoff||ms(r.kickoff)<ms(rec.earliestKickoff)?r.kickoff:rec.earliestKickoff;
  rec.latestKickoff=!rec.latestKickoff||ms(r.kickoff)>ms(rec.latestKickoff)?r.kickoff:rec.latestKickoff;
  const kickoff=ms(r.kickoff);
  if(r.gradedAt!==null&&r.gradedAt!==undefined){
   if(!Number.isFinite(ms(r.gradedAt))||ms(r.gradedAt)<kickoff||ms(r.gradedAt)>now){
    mark("INVALID_GRADE_CHRONOLOGY");continue
   }
   rec.graded++;
  }else if(kickoff>now)rec.future++;
  else if(now-kickoff<minElapsedHours*3600000)rec.inProgressOrRecentlyFinished++;
  else{
   rec.overdueWithoutVerifiedGrade++;
   latePhysical.add(key);ungradedPhysical.add(key);
  }
 }
 for(const [modelId,rec] of Object.entries(group)){
  const ids=new Set(rows.filter(r=>r.modelId===modelId).map(r=>
   [r.homeTeamId,r.awayTeamId,ms(r.kickoff)].join("|")));
  rec.distinctGames=ids.size;
  rec.researchOnly=true;
  if(modelId==="NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3")
   rec.status="SUPERSEDED_KICKOFF_FIELD_VERSION";
  else rec.status=rec.overdueWithoutVerifiedGrade?"AWAITING_VERIFIED_FINALS":
   rec.graded?"PARTIALLY_GRADED":"COLLECTING_PROSPECTIVE_EVIDENCE";
 }
 return {sport,asOf,sourceLatestObservedAt:Number.isFinite(latest)?sourceLatestObservedAt:null,
  sourceAgeHours:Number.isFinite(latest)?Math.round((now-latest)/3600000*100)/100:null,
  receiptCount:Object.values(group).reduce((n,r)=>n+r.receipts,0),
  distinctPhysicalGames:physical.size,overduePhysicalGames:latePhysical.size,
  models:group,excluded:exclude,canQualify:false,canAuthorizeWager:false,
  calibrated:false,CLV:null,ROI:null};
}
