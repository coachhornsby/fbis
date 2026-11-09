// Model-stat validity, independent of market quote freshness. No source clock renewal.
import {resolveTeamExact} from '../../functions/lib/teams.js';
export function cfbdPregameValidity(game,{ppaPacket,schedulePacket,now=Date.now()}={}){
 const deny=reason=>({verified:false,reason});
 const start=Date.parse(game?.start),ppaAt=Date.parse(ppaPacket?.capturedAt),scheduleAt=Date.parse(schedulePacket?.capturedAt);
 if(!Number.isFinite(now)||!Number.isFinite(start)||start<=now||![ppaAt,scheduleAt].every(t=>Number.isFinite(t)&&t<=now&&t<start)||(now-ppaAt>72*3600000||now-scheduleAt>72*3600000)||ppaPacket?.endpoint!=='/ppa/games'||schedulePacket?.endpoint!=='/games'||ppaPacket?.query?.year!==schedulePacket?.query?.year||!Array.isArray(schedulePacket.data)||!Array.isArray(ppaPacket.rows))return deny('COVERAGE_PROVENANCE_UNVERIFIED');
 if(new Set(schedulePacket.data.map(g=>String(g.id))).size!==schedulePacket.data.length)return deny('DUPLICATE_SCHEDULE_GAME');
 const target=schedulePacket.data.filter(g=>String(g.id)===String(game.id??game.eventId)&&Number(g.season)===ppaPacket.query.year&&g.seasonType==='regular'&&Date.parse(g.startDate)===start&&resolveTeamExact('cfb',{name:g.homeTeam})?.id==='cfb-'+game.home?.espnId&&resolveTeamExact('cfb',{name:g.awayTeam})?.id==='cfb-'+game.away?.espnId);
 if(target.length!==1||target[0].completed!==false)return deny('TARGET_SCHEDULE_UNVERIFIED');
 const teams=[];
 for(const side of ['home','away']){
  const id='cfb-'+String(game?.[side]?.espnId||'');
  const games=schedulePacket.data.filter(g=>Number(g.season)===ppaPacket.query.year&&g.seasonType==='regular'&&[g.homeTeam,g.awayTeam].some(name=>resolveTeamExact('cfb',{name})?.id===id));
  if(!games.length||games.some(g=>!Number.isFinite(Date.parse(g.startDate))))return deny('TEAM_SCHEDULE_UNVERIFIED');
  const prior=games.filter(g=>Date.parse(g.startDate)<start);
  // An intervening scheduled game, even if not yet started, requires new postgame evidence.
  if(prior.some(g=>g.completed!==true||Date.parse(g.startDate)>=Math.min(ppaAt,scheduleAt)||g.homePoints==null||g.awayPoints==null||!Number.isFinite(Number(g.homePoints))||!Number.isFinite(Number(g.awayPoints))))return deny('INTERVENING_OR_UNVERIFIED_GAME');
  const rows=ppaPacket.rows.filter(r=>r.canonicalId===id&&r.year===ppaPacket.query.year);
  const byId=new Map(rows.map(r=>[String(r.gameId),r]));
  if(byId.size!==rows.length||prior.length<3||prior.some(g=>{const r=byId.get(String(g.id));return !r||r.offensePpa==null||r.defensePpa==null||!Number.isFinite(Number(r.offensePpa))||!Number.isFinite(Number(r.defensePpa));}))return deny('COMPLETED_GAME_STATS_MISSING');
  if(rows.some(r=>!prior.some(g=>String(g.id)===String(r.gameId))))return deny('PPA_OUTSIDE_PREGAME_HISTORY');
  prior.sort((a,b)=>Date.parse(b.startDate)-Date.parse(a.startDate));
  teams.push({canonicalId:id,latestCompletedGameId:String(prior[0].id),completedGameIds:prior.map(g=>String(g.id))});
 }
 return {verified:true,policy:'completed-games-pregame-v1',ppaCapturedAt:ppaPacket.capturedAt,scheduleCapturedAt:schedulePacket.capturedAt,verifiedAt:new Date(now).toISOString(),validUntil:new Date(Math.min(start,ppaAt+72*3600000,scheduleAt+72*3600000)).toISOString(),teams};
}
