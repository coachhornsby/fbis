/** Offline-only adapter. No network, storage, collector or production authority. */
import { NBA_TEAM_GEO, haversineMiles } from './nbaTravelContext.js';
import { buildNbaDeepFeatures } from './nbaDeepFeatures.js';
const ms = x => typeof x === 'string' && x.trim() ? Date.parse(x) : NaN;
const id = x => String(x ?? '');
const teamId = (g, s) => id(g?.[s+'Id'] ?? g?.[s]?.id);
const start = g => ms(g?.start ?? g?.date);
function venue(g) {
  if(typeof g?.neutralSite!=='boolean') return null;
  const v=g?.venueGeo;
  if(v && [v.lat,v.lon,v.altitudeFt].every(Number.isFinite) && Math.abs(v.lat)<=90 && Math.abs(v.lon)<=180 && typeof v.tz==='string') {
    try { new Intl.DateTimeFormat('en-US',{timeZone:v.tz}); return v; } catch { return null; }
  }
  // Unknown is not equivalent to a confirmed home venue.
  if(g?.neutralSite!==false) return null;
  return NBA_TEAM_GEO[g?.home?.abbr ?? g?.homeAbbr] ?? null;
}
function calendarDay(t,tz) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
  return Date.UTC(+p.year,+p.month-1,+p.day)/86400000;
}
function offset(t,tz) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
 return (Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-Math.floor(t/60000)*60000)/3600000;
}
function schedule(games,target,side,cutoff,completeSince,snapshotTime) {
 const tid=teamId(target,side), t=start(target), dest=venue(target);
 const seen=new Map();
 for(const g of games) {
   if(!id(g.id)) continue;
   const old=seen.get(id(g.id));
   if(old && JSON.stringify(old)!==JSON.stringify(g) && [teamId(g,'home'),teamId(g,'away'),teamId(old,'home'),teamId(old,'away')].includes(tid)) return {known:false,reason:'conflicting_schedule_duplicates'};
   seen.set(id(g.id),g);
 }
 const ambiguous=games.some(g=>tid && [teamId(g,'home'),teamId(g,'away')].includes(tid) && id(g.id)!==id(target.id) && Number.isFinite(start(g)) && start(g)<t && start(g)>=completeSince && (g.final!==true || !g.source || !Number.isFinite(ms(g.observedAt)) || ms(g.observedAt)>snapshotTime || ms(g.observedAt)<ms(g.completedAt) || !Number.isFinite(ms(g.completedAt)) || ms(g.completedAt)>cutoff || ms(g.completedAt)<start(g)));
 if(ambiguous) return {known:false,reason:'intervening_game_unresolved'};
 const prior=games.filter(g=>tid && [teamId(g,'home'),teamId(g,'away')].includes(tid) && id(g.id)!==id(target.id) && g.final===true && Number.isFinite(ms(g.completedAt)) && ms(g.completedAt)<=cutoff && Number.isFinite(start(g)) && start(g)<t && start(g)<cutoff && ms(g.completedAt)>=start(g))
   .sort((a,b)=>start(b)-start(a));
 const unique=[...new Map(prior.map(g=>[id(g.id),g])).values()].filter(g=>id(g.id));
 const prev=unique[0], origin=prev&&venue(prev);
 // Must explicitly cover the last six days and the previous game; an absent game is not rest.
 const coverage=Number.isFinite(completeSince) && completeSince<=t-6*86400000 && prev && completeSince<=start(prev);
 if(!coverage || !dest || !origin) return {known:false,reason:!coverage?'schedule_coverage_missing':'venue_unknown',priorGameId:prev?.id??null};
 const day=calendarDay(t,dest.tz), prevDay=calendarDay(start(prev),dest.tz);
 const daysRest=Math.max(0,day-prevDay-1);
 const recent=days=>unique.filter(g=>{const d=day-calendarDay(start(g),dest.tz);return d>=0 && d<days;}).length;
 const travelMiles=haversineMiles(origin,dest);
 return {known:true,daysRest,backToBack:day-prevDay===1,threeInFour:recent(4)>=2,fourInSix:recent(6)>=3,travelMiles,timeZonesCrossed:Math.abs(offset(t,origin.tz)-offset(t,dest.tz)),altitudeFeet:dest.altitudeFt,altitudeDestination:dest.altitudeFt>=4000,longTravel:travelMiles>=1200,priorGameId:prev.id,travelKind:'arena_to_arena_estimate',restConvention:'destination_calendar_days'};
}
function personnel(rows,target,side,cutoff,maxAgeHours) {
 const accepted=new Map(); let rejected=0;
 for(const r of rows) {
  if(id(r.game_id??r.gameId)!==id(target.id) || id(r.team_id??r.teamId)!==teamId(target,side)) continue;
  const observed=ms(r.observed_at??r.observedAt), player=id(r.player_id??r.playerId);
  if(!player || !r.source || !Number.isFinite(observed) || observed>cutoff || cutoff-observed>maxAgeHours*3600000) {rejected++;continue;}
  const old=accepted.get(player);
  if(!old || observed>ms(old.observedAt)) accepted.set(player,{playerId:player,status:String(r.status??r.lineup_status??'UNKNOWN').toUpperCase(),observedAt:new Date(observed).toISOString(),source:r.source});
 }
 // Presence of an injury or starter row never proves complete roster coverage.
 return {rows:[...accepted.values()],rejected,availabilityVerified:false,impactVerified:false};
}
export function buildNbaResearchContext({game,games=[],asOf,scheduleObservedAt,scheduleCompleteSince,scheduleSource,personnelRows=[],maxAgeHours=24}={}) {
 const cutoff=ms(asOf), tip=start(game), observed=ms(scheduleObservedAt);
 if(typeof game?.neutralSite!=='boolean' || !game?.id || !teamId(game,'home') || !teamId(game,'away') || teamId(game,'home')===teamId(game,'away') || !Number.isFinite(cutoff) || !Number.isFinite(tip) || cutoff>=tip || !Number.isFinite(maxAgeHours) || maxAgeHours<=0 || maxAgeHours>24) return {ok:false,reason:'invalid_pregame_checkpoint',researchOnly:true,canAuthorize:false,canQualify:false};
 const scheduleFresh=typeof scheduleSource==='string' && scheduleSource.trim() && Number.isFinite(observed) && observed<=cutoff && cutoff-observed<=24*3600000;
 const contexts={};
 for(const side of ['home','away']) contexts[side]={schedule:scheduleFresh?schedule(games,game,side,cutoff,ms(scheduleCompleteSince),observed):{known:false,reason:'schedule_stale_or_future'},personnel:personnel(personnelRows,game,side,cutoff,maxAgeHours)};
 return {ok:true,asOf,scheduleProvenance:{source:scheduleSource??null,observedAt:scheduleObservedAt??null,completeSince:scheduleCompleteSince??null},researchOnly:true,canAuthorize:false,canQualify:false,contexts,blockers:['personnel_impact_and_coverage_unverified','model_not_validated','executable_price_unverified',...Object.entries(contexts).filter(([,v])=>!v.schedule.known).map(([s,v])=>s+'_'+v.schedule.reason)]};
}
/** Builds a research feature vector only from temporally admissible existing history. */
export function projectNbaResearchSnapshot(input={}) {
 const context=buildNbaResearchContext(input);
 if(!context.ok || Object.values(context.contexts).some(c=>!c.schedule.known)) return {...context,features:null};
 const cutoff=ms(input.asOf);
 const history=side=>{
  const eligible=(input[side+'History']??[]).filter(r=>id(r.gameId) && id(r.gameId)!==id(input.game.id) && typeof r.source==='string' && r.source.trim() && r.final===true && Number.isFinite(start(r)) && start(r)<cutoff && Number.isFinite(ms(r.completedAt)) && ms(r.completedAt)>=start(r) && Number.isFinite(ms(r.observedAt)) && ms(r.observedAt)>=ms(r.completedAt) && ms(r.observedAt)<=cutoff && teamId(input.game,side)===id(r.teamId)).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt));
  const unique=new Map(); for(const row of eligible) if(!unique.has(id(row.gameId))) unique.set(id(row.gameId),row);
  return [...unique.values()].map(row=>({...row,date:new Date(start(row)).toISOString()}));
 };
 const homeHistory=history('home'),awayHistory=history('away');
 const historyProvenance=Object.fromEntries([['home',homeHistory],['away',awayHistory]].map(([side,rows])=>[side,rows.map(({gameId,source,observedAt,completedAt})=>({gameId,source,observedAt,completedAt}))]));
 const features=buildNbaDeepFeatures(input.game,{homeHistory,awayHistory,homeSchedule:context.contexts.home.schedule,awaySchedule:context.contexts.away.schedule});
 // Accepted injury statuses are exposed for research, never converted into invented impact weights.
 if(features.incumbent) features.incumbent={...features.incumbent,canQualify:false,canAuthorize:false};
 return {...context,historyProvenance,features};
}
