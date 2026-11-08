import {projectNbaResearchSnapshot} from '../../functions/lib/nbaResearchContext.js';
const aliases={GS:'GSW',NY:'NYK',NO:'NOP',SA:'SAS',UTAH:'UTA',WSH:'WAS'};
const abbr=v=>aliases[v]||v;
/** Observation of FINAL proves completion no later than this timestamp, not an exact end time. */
export function captureNbaSchedule(payload,{observedAt,url,date,maxRecords=100}={}){
 if(!Number.isFinite(Date.parse(observedAt))||!Array.isArray(payload?.events)||payload.events.length>=maxRecords)return {ok:false,date,reason:'INVALID_OR_TRUNCATED_SCHEDULE'};
 const games=[];
 for(const e of payload.events){
  if(!Array.isArray(e.competitions)||!e.competitions.length)return {ok:false,date,reason:'MALFORMED_SCHEDULE_EVENT'};
  for(const c of e.competitions||[]){
   const h=c.competitors?.find(x=>x.homeAway==='home'),a=c.competitors?.find(x=>x.homeAway==='away');
   if(!c.id||!h?.team?.id||!a?.team?.id||!Number.isFinite(Date.parse(c.date||e.date)))return {ok:false,date,reason:'MALFORMED_SCHEDULE_GAME'};
   const final=c.status?.type?.completed===true||e.status?.type?.completed===true;
   games.push({id:String(c.id),homeId:String(h.team.id),awayId:String(a.team.id),homeAbbr:abbr(h.team.abbreviation),awayAbbr:abbr(a.team.abbreviation),start:c.date||e.date,neutralSite:typeof c.neutralSite==='boolean'?c.neutralSite:null,final,completedAt:final?observedAt:null,completionTimeKind:final?'observed_final_upper_bound':null,observedAt,source:url});
  }
 }
 return {ok:true,date,observedAt,url,games};
}
export function boardNbaSchedule(board,observedAt){
 const rows=(board.games||[]).filter(g=>g.sport==='nba');
 if(!board.feeds?.nba?.ok||rows.length>=500)return {ok:false,reason:'CURRENT_BOARD_INCOMPLETE'};
 return {ok:true,observedAt,games:rows.map(g=>({id:String(g.id),homeId:String(g.home.espnId),awayId:String(g.away.espnId),homeAbbr:abbr(g.home.abbr),awayAbbr:abbr(g.away.abbr),start:g.start,neutralSite:g.neutralSite,final:g.status==='final',completedAt:g.status==='final'?observedAt:null,completionTimeKind:g.status==='final'?'observed_final_upper_bound':null,observedAt,source:g.source||'ESPN_SCOREBOARD'}))};
}
export function runNbaRecoveryShadow({game,baseline,homeHistory,awayHistory,captures,currentBoard,date,asOf}){
 const dates=Array.from({length:15},(_,i)=>new Date(Date.parse(date+'T12:00:00Z')-(i+1)*86400000).toISOString().slice(0,10));
 const complete=dates.every(d=>captures.some(c=>c.date===d&&c.ok))&&currentBoard.ok;
 const normalized={...game,homeId:String(game.home.espnId),awayId:String(game.away.espnId),homeAbbr:abbr(game.home.abbr),awayAbbr:abbr(game.away.abbr)};
 const eligible=[...captures.filter(c=>c.ok),...(currentBoard.ok?[currentBoard]:[])];
 const observedAt=eligible.map(c=>c.observedAt).sort().at(-1);
 const result=projectNbaResearchSnapshot({game:normalized,games:eligible.flatMap(c=>c.games),asOf,scheduleObservedAt:observedAt,scheduleSource:'ESPN already-fetched schedule snapshots',scheduleCompleteSince:complete?dates.at(-2)+'T00:00:00Z':null,homeHistory,awayHistory,personnelRows:[]});
 const shadow=result.features?.ok?result.features.incumbent:null;
 return {eventId:String(game.id),asOf,mode:'SHADOW_ONLY',canAuthorize:false,canQualify:false,productionForecastUnchanged:true,extraProviderCalls:0,completionTimestampMeaning:'Final status capture is an upper bound, not an exact game end time',scheduleCoverageComplete:complete,acceptedHistory:{home:result.historyProvenance?.home?.length||0,away:result.historyProvenance?.away?.length||0},context:result.contexts||null,blockers:result.blockers||[result.reason],baseline:{margin:baseline.margin,total:baseline.total,pHomeWin:baseline.pHomeWin},shadow:shadow?{margin:shadow.margin,total:shadow.total,pHomeWin:shadow.pHomeWin}:null,pairedDelta:shadow?{margin:shadow.margin-baseline.margin,total:shadow.total-baseline.total,pHomeWin:shadow.pHomeWin-baseline.pHomeWin}:null};
}

export async function captureNbaResponse(response,url,{maxBytes=3800000}={}){
 const stamp=new URL(url).searchParams.get('dates');
 const date=/^\d{8}$/.test(stamp||'')?stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6):null;
 if(!date||!response.ok)return {ok:false,date,reason:'CURRENT_RAW_SCHEDULE_UNAVAILABLE'};
 const reader=response.clone().body.getReader(),chunks=[];let bytes=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){void reader.cancel().catch(()=>{});return {ok:false,date,reason:'CURRENT_NBA_SCHEDULE_TOO_LARGE'};}chunks.push(value);}
  const raw=new Uint8Array(bytes);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}
  return captureNbaSchedule(JSON.parse(new TextDecoder().decode(raw)),{observedAt:new Date().toISOString(),url:String(url),date,maxRecords:500});
 }catch(error){void reader.cancel().catch(()=>{});return {ok:false,date,reason:String(error.message||error)};}
 finally{reader.releaseLock();}
}
export function combineNbaCurrentCaptures(captures,date){
 const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const selected=[date,next].map(d=>captures.find(c=>c.date===d));
 if(selected.some(c=>!c?.ok))return {ok:false,reason:'CURRENT_RAW_SCHEDULE_INCOMPLETE'};
 return {ok:true,observedAt:selected.map(c=>c.observedAt).sort().at(-1),games:selected.flatMap(c=>c.games)};
}
