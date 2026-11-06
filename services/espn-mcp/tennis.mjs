// ESPN tournament scoreboards contain many days and multiple draws.
// Normalize match competitions only; never use tournament status or date as match evidence.
const tours={atp:'mens',wta:'womens'};
const tour={type:'string',enum:['atp','wta']};
const date={type:'string',pattern:'^[0-9]{8}$'};
const tournament_id={type:'string',pattern:'^[0-9]{1,8}-[0-9]{4}$'};
export const TENNIS_TOOLS=[
 {name:'espn_tennis_scoreboard',description:'ESPN ATP or WTA matches for an America/Chicago date. Singles by default; doubles/all optional. Returns player IDs, set and tiebreak scores, rounds, match statuses, verified-time flags and source provenance. ESPN coverage is not a complete Challenger/ITF feed.',inputSchema:{type:'object',properties:{tour,date,match_type:{type:'string',enum:['singles','doubles','all']},tournament_id,offset:{type:'integer',minimum:0,maximum:10000},limit:{type:'integer',minimum:1,maximum:100}},required:['tour'],additionalProperties:false}},
 {name:'espn_tennis_match',description:'Read one ESPN tennis match from its dated tournament scoreboard using its tournament ID and competition ID. Includes source player IDs, set scores, status and any statistics present. Match date uses America/Chicago. Does not claim a separate ESPN summary feed or betting authority.',inputSchema:{type:'object',properties:{tour,date,tournament_id,competition_id:{type:'string',pattern:'^[0-9]{1,15}$'}},required:['tour','date','tournament_id','competition_id'],additionalProperties:false}}
];
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
const localDay=d=>dayFormat.format(new Date(d)).replaceAll('-','');
function validDate(d){if(typeof d!=='string'||!/^\d{8}$/.test(d))return false;const x=new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}T00:00:00Z`);return Number.isFinite(x.getTime())&&x.toISOString().slice(0,10).replaceAll('-','')===d;}
export function tennisRequestSpec(name,a){
 if(!Object.hasOwn(tours,a.tour))throw Error('SUPPORTED_TENNIS_TOUR_REQUIRED');
 const d=a.date??localDay(Date.now());if(!validDate(d))throw Error('INVALID_DATE');
 if(name==='espn_tennis_match'&&a.date===undefined)throw Error('MATCH_DATE_REQUIRED');
 const kind=a.match_type??(name==='espn_tennis_match'?'all':'singles');if(!['singles','doubles','all'].includes(kind))throw Error('INVALID_MATCH_TYPE');
 if(a.tournament_id!==undefined&&(typeof a.tournament_id!=='string'||!/^\d{1,8}-\d{4}$/.test(a.tournament_id)))throw Error('INVALID_TOURNAMENT_ID');
 if(name==='espn_tennis_match'&&(!a.tournament_id||typeof a.competition_id!=='string'||!/^\d{1,15}$/.test(a.competition_id)))throw Error('TOURNAMENT_AND_COMPETITION_IDS_REQUIRED');
 const offset=a.offset??0,limit=a.limit??25;if(!Number.isInteger(offset)||offset<0||offset>10000||!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_PAGINATION');
 const url=new URL(`https://site.api.espn.com/apis/site/v2/sports/tennis/${a.tour}/scoreboard`);url.searchParams.set('dates',d);url.searchParams.set('limit','1000');
 return {tennis:true,url,action:name==='espn_tennis_match'?'tennis_match':'tennis_scoreboard',tour:a.tour,date:d,kind,offset,limit,tournament_id:a.tournament_id,competition_id:a.competition_id};
}
function player(a,fallback){
 const name=a?.displayName||a?.fullName;
 if(typeof name!=='string'||!name.trim()||/^TBD$/i.test(name.trim()))throw Error('UNRESOLVED_PLAYER_IDENTITY');
 let linkId=null,profileUrl=null;
 for(const link of a.links||[]){try{const u=new URL(link.href);const m=/^\/tennis\/player\/_\/id\/([1-9]\d*)(?:\/|$)/.exec(u.pathname);if(u.protocol==='https:'&&['www.espn.com','espn.com'].includes(u.hostname)&&m){linkId=m[1];profileUrl=u.href;break;}}catch{}}
 const own=/^[1-9]\d*$/.test(String(a.id??''))?String(a.id):null;
 const competitor=/^[1-9]\d*$/.test(String(fallback??''))?String(fallback):null;
 const ids=[own,competitor,linkId].filter(Boolean);if(!ids.length)throw Error('UNRESOLVED_PLAYER_IDENTITY');if(new Set(ids).size!==1)throw Error('PLAYER_ID_CONFLICT');
 return {id:ids[0],idSource:own?'athlete.id':competitor?'competitor.id':'athlete.links.playercard',displayName:name,shortName:a.shortName??null,country:a.flag?.alt??null,flag:a.flag?.href??null,headshot:a.headshot?.href??(typeof a.headshot==='string'?a.headshot:null),profileUrl};
}
function side(c,kind,state){
 const athletes=kind==='singles'?[player(c.athlete||{},c.id)]:(c.roster?.athletes||[]).map(a=>player(a));
 if(athletes.length!==(kind==='singles'?1:2))throw Error('UNRESOLVED_PLAYER_IDENTITY');
 const sets=(Array.isArray(c.linescores)?c.linescores:[]).map((s,i)=>({set:i+1,games:typeof s.value==='number'?s.value:null,tiebreak:typeof s.tiebreak==='number'?s.tiebreak:null,winner:typeof s.winner==='boolean'?s.winner:null,displayValue:s.displayValue??null}));
 return {id:c.id??null,type:kind==='singles'?'athlete':'doubles-team',order:c.order??null,winner:typeof c.winner==='boolean'?c.winner:null,players:athletes,providerScore:c.score??null,scoreAvailable:['in','post'].includes(state)&&sets.some(s=>s.games!==null),sets,setsWon:['in','post'].includes(state)&&sets.length>0&&sets.every(s=>s.winner!==null)?sets.filter(s=>s.winner).length:null,setsWonSource:'ESPN linescores[].winner when present',statistics:(Array.isArray(c.statistics)?c.statistics:[]).map(s=>({name:s.name??null,label:s.label??s.displayName??null,value:s.value??null,displayValue:s.displayValue??null}))};
}
export function extractTennis(data,spec){
 if(!Array.isArray(data.events))throw Error('UPSTREAM_TENNIS_SCHEMA_INVALID');
 const matches=[],tournaments=[],seen=new Map(),rejections={};let sourceCompetitions=0;
 const skip=r=>{rejections[r]=(rejections[r]||0)+1;};
 for(const e of data.events){
  if(spec.tournament_id&&String(e.id)!==spec.tournament_id)continue;
  if(!/^\d{1,8}-\d{4}$/.test(String(e.id))){skip('INVALID_TOURNAMENT_ID');continue;}
  tournaments.push({id:String(e.id),name:e.name??null,startDate:e.date??null,endDate:e.endDate??null,venue:e.venue?.displayName??null});
  const groups=Array.isArray(e.groupings)?e.groupings:[];
  const entries=[...groups.flatMap(g=>(Array.isArray(g.competitions)?g.competitions:[]).map(c=>({c,slug:c.type?.slug??g.grouping?.slug}))),...(Array.isArray(e.competitions)?e.competitions:[]).map(c=>({c,slug:c.type?.slug}))];
  for(const {c,slug} of entries){
   sourceCompetitions++;
   const kind=slug===tours[spec.tour]+'-singles'?'singles':slug===tours[spec.tour]+'-doubles'?'doubles':null;
   if(!kind||spec.kind!=='all'&&spec.kind!==kind){skip('OTHER_DRAW');continue;}
   if(!/^\d{1,15}$/.test(String(c.id))){skip('INVALID_COMPETITION_ID');continue;}
   if(typeof c.date!=='string'||!Number.isFinite(Date.parse(c.date))){skip('MATCH_DATE_UNAVAILABLE');continue;}
   if(localDay(c.date)!==spec.date){skip('OTHER_DATE');continue;}
   if(!Array.isArray(c.competitors)||c.competitors.length!==2){skip('UNRESOLVED_COMPETITORS');continue;}
   try{
    const competitors=c.competitors.map(x=>side(x,kind,c.status?.type?.state));
    const ids=competitors.flatMap(x=>x.players.map(p=>p.id));if(new Set(ids).size!==ids.length){skip('DUPLICATE_PLAYER_IDENTITY');continue;}
    const match={id:`tennis:espn:${spec.tour}:${e.id}:${c.id}`,tour:spec.tour,tournamentId:String(e.id),competitionId:String(c.id),uid:c.uid??null,tournament:e.name??null,matchType:kind,date:c.date,timeVerified:c.timeValid===true,round:{id:c.round?.id??null,name:c.round?.displayName??null},status:c.status??null,venue:c.venue?.fullName??e.venue?.displayName??null,court:c.venue?.court??null,surface:c.surface??e.surface??null,competitors,notes:(c.notes||[]).map(n=>({text:n.text??null,type:n.type??null})),wasSuspended:c.wasSuspended??null};
    if(seen.has(match.id)){const i=seen.get(match.id);if(JSON.stringify(matches[i])!==JSON.stringify(match))throw Error('UPSTREAM_CONFLICTING_MATCH_DUPLICATE');skip('DUPLICATE_MATCH');continue;}
    seen.set(match.id,matches.length);matches.push(match);
   }catch(e){if(e.message==='UPSTREAM_CONFLICTING_MATCH_DUPLICATE')throw e;skip(e.message);}
  }
 }
 matches.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id));
 return {matches,tournaments,sourceTournaments:data.events.length,sourceCompetitions,rejections};
}
export function tennisPayload(data,spec){
 const result=extractTennis(data,spec);const {matches,...evidence}=result;
 const base={...evidence,tour:spec.tour,matchType:spec.kind,dateFilterTimeZone:'America/Chicago',coverage:'America/Chicago-dated matches within tournaments returned by the ESPN date lookup; not complete Challenger/ITF coverage',upstreamDateSelection:'Single ESPN calendar-date lookup; date ranges are not supported. Tournaments omitted by ESPN are outside this result.',upstreamCalendarTimeZones:[...new Set(data.events.map(e=>e.calendar?.timeZone).filter(Boolean))],playerDirectoryScope:'participants in returned matches only',officialTourAuthority:false,wagerAuthority:false,upstreamLimit:1000,upstreamMayBeTruncated:data.events.length>=1000};
 if(spec.action==='tennis_match'){
  const match=matches.find(m=>m.tournamentId===spec.tournament_id&&m.competitionId===spec.competition_id);if(!match)return {...base,error:'MATCH_NOT_FOUND_FOR_DATE',data:{match:null}};
  return {...base,data:{match},statisticsAvailable:match.competitors.some(c=>c.statistics.length>0),detailSource:'dated ESPN tournament scoreboard (not a separate summary endpoint)'};
 }
 const shown=matches.slice(spec.offset,spec.offset+spec.limit);const nextOffset=spec.offset+shown.length<matches.length?spec.offset+shown.length:null;
 return {...base,totalRetrieved:matches.length,shown:shown.length,offset:spec.offset,nextOffset,truncated:nextOffset!==null,data:{matches:shown}};
}
