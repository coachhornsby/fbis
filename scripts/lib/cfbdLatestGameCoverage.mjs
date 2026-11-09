// Coverage audit only: source age is not a proxy for included completed-game statistics.
import{resolveTeamExact}from'../../functions/lib/teams.js';
export function cfbdLatestGameCoverage({ppaPacket,schedulePacket,teamIds,now=Date.now()}={}){
 const capture=Date.parse(ppaPacket?.capturedAt),scheduleCapture=Date.parse(schedulePacket?.capturedAt);
 if(ppaPacket?.endpoint!=='/ppa/games'||schedulePacket?.endpoint!=='/games'||ppaPacket?.query?.year!==schedulePacket?.query?.year||!Number.isFinite(capture)||!Number.isFinite(scheduleCapture)||capture>now||scheduleCapture>now)return {verified:false,reason:'SOURCE_PROVENANCE_UNVERIFIED',teams:[]};
 const year=ppaPacket.query.year,teams=[];
 for(const canonicalId of new Set(teamIds||[])){
  const completed=(schedulePacket.data||[]).filter(g=>Number(g.season)===year&&g.seasonType==='regular'&&g.completed===true&&g.homePoints!=null&&g.awayPoints!=null&&Number.isFinite(Number(g.homePoints))&&Number.isFinite(Number(g.awayPoints))&&Number.isFinite(Date.parse(g.startDate))&&Date.parse(g.startDate)<capture&&[g.homeTeam,g.awayTeam].some(name=>resolveTeamExact('cfb',{name})?.id===canonicalId)).sort((a,b)=>Date.parse(b.startDate)-Date.parse(a.startDate));
  const ppa=new Map((ppaPacket.rows||[]).filter(r=>r.canonicalId===canonicalId&&r.year===year&&r.offensePpa!=null&&r.defensePpa!=null&&Number.isFinite(Number(r.offensePpa))&&Number.isFinite(Number(r.defensePpa))).map(r=>[String(r.gameId),r]));
  const latest=completed[0],missing=completed.filter(g=>!ppa.has(String(g.id))).map(g=>String(g.id));
  teams.push({canonicalId,latestCompletedGameId:latest?String(latest.id):null,latestCompletedKickoff:latest?.startDate||null,latestCompletedIncluded:latest?ppa.has(String(latest.id)):null,completedGames:completed.length,missingCompletedGameIds:missing,state:!latest?'NO_VERIFIED_COMPLETED_GAME':missing.length?'COMPLETED_GAME_STATS_MISSING':'ALL_OBSERVED_COMPLETED_GAMES_INCLUDED'});
 }
 return {verified:true,ppaCapturedAt:ppaPacket.capturedAt,scheduleCapturedAt:schedulePacket.capturedAt,scope:'Completed regular-season games observed in captured schedule; not proof of newer unobserved provider updates',teams};
}
