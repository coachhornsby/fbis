// Exact SP-component branch of the existing frozen A/A prior builder.
// These are historical 2025 inputs captured now, not a claim of a 2025 capture.
import {createHash} from 'node:crypto';
import {buildPriorCatalog} from '../../functions/lib/cfbFeaturePipeline.js';
import {resolveTeamExact} from '../../functions/lib/teams.js';
import {projectCfbdFittedRecovery} from './cfbdFittedRecovery.mjs';
const SOURCES={sp:'/ratings/sp',talent:'/talent',returning:'/player/returning',recruiting:'/recruiting/teams'};
const finite=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
async function getRows(path,year,{key,fetchFn,now,reserve}){
 reserve?.('CFBD');
 const response=await fetchFn(`https://api.collegefootballdata.com${path}?year=${year}`,{redirect:'manual',headers:{Accept:'application/json',Authorization:'Bearer '+key},signal:AbortSignal.timeout(16000)});
 if(!response.ok||response.status>=300)throw Error('CFBD_HISTORY_HTTP_'+response.status);
 if(Number(response.headers?.get('content-length'))>3000000)throw Error('CFBD_HISTORY_TOO_LARGE');
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>3000000)throw Error('CFBD_HISTORY_TOO_LARGE');
 const data=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(data)||data.length>4000)throw Error('CFBD_HISTORY_SHAPE_INVALID');
 return {data,path,capturedAt:new Date(typeof now==='function'?now():now).toISOString(),responseSha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function captureCfbdFrozenPrior({key,year=2025,fetchFn=fetch,now=Date.now,reserve}={}){
 if(!key||!Number.isInteger(year)||year<2020||year>2030)throw Error('CFBD_HISTORY_CONFIG_INVALID');
 const endpoints={};
 for(const [name,path]of Object.entries(SOURCES)){
  endpoints[name]=await getRows(path,year,{key,fetchFn,now,reserve});
  if(endpoints[name].data.some(r=>(r.year??r.season)!=null&&Number(r.year??r.season)!==year))throw Error('CFBD_PRIOR_SOURCE_SEASON_MISMATCH');
 }
 const catalog=buildPriorCatalog({season:year,endpoints});
 const rows=[];
 for(const sp of endpoints.sp.data){
  // Refuse unit-changing fallbacks to CORE or overall-consensus approximations.
  if(!finite(sp.rating)||!finite(sp.offense?.rating)||!finite(sp.defense?.rating))continue;
  if(sp.year!=null&&Number(sp.year)!==year)continue;
  const team=resolveTeamExact('cfb',{name:sp.team});if(!team)continue;
  const prior=Object.values(catalog.bySchool).find(p=>p.school===sp.team);
  if(!prior||!finite(prior.priorOff)||!finite(prior.priorDef))continue;
  rows.push({canonicalId:team.id,team:sp.team,sourceSeason:year,priorOff:prior.priorOff,priorDef:prior.priorDef,artifactHash:prior.artifactHash,missingness:prior.missingness});
 }
 const provenance=Object.fromEntries(Object.entries(endpoints).map(([k,v])=>[k,{endpoint:v.path,capturedAt:v.capturedAt,responseSha256:v.responseSha256,rows:v.data.length}]));
 const packet={version:1,visibility:'PRIVATE_SOURCE_EVIDENCE',provider:'CFBD',sourceSeason:year,frozen:true,featureContract:'ppa-derived-base-v2',builder:'buildPriorCatalog/SP-components',rows,provenance,canAuthorizeWager:false};
 return {packet,receipt:{provider:'CFBD',sourceSeason:year,requests:4,acceptedRows:rows.length,provenance}};
}
export async function captureCfbdCompletionSchedule({key,year=2026,fetchFn=fetch,now=Date.now,reserve}={}){
 if(!key||!Number.isInteger(year)||year<2020||year>2030)throw Error('CFBD_HISTORY_CONFIG_INVALID');
 // The all-season query is bounded to one response and contains no forecasts.
 const result=await getRows('/games',year,{key,fetchFn,now,reserve});
 return {packet:{provider:'CFBD',endpoint:'/games',query:{year},...result},receipt:{provider:'CFBD',endpoint:'/games',year,requests:1,rows:result.data.length,responseSha256:result.responseSha256,capturedAt:result.capturedAt}};
}
export function attachCfbdCompletionEvidence(ppaPacket,schedulePacket){
 if(ppaPacket?.query?.year!==schedulePacket?.query?.year||schedulePacket?.endpoint!=='/games')throw Error('CFBD_SCHEDULE_SEASON_MISMATCH');
 const byId=new Map();for(const g of schedulePacket.data||[]){const id=String(g.id);if(byId.has(id))throw Error('CFBD_SCHEDULE_DUPLICATE_ID');byId.set(id,g);}
 return {...ppaPacket,scheduleProvenance:{capturedAt:schedulePacket.capturedAt,responseSha256:schedulePacket.responseSha256},rows:(ppaPacket.rows||[]).map(r=>{
  const g=byId.get(String(r.gameId));
  const identities=g?[g.homeTeam,g.awayTeam].map(name=>resolveTeamExact('cfb',{name})?.id):[];
  const verified=g&&identities.includes(r.canonicalId)&&Number(g.season)===r.year&&g.completed===true&&finite(g.homePoints)&&finite(g.awayPoints)&&Number.isFinite(Date.parse(g.startDate));
  return {...r,startDate:verified?g.startDate:null,completed:Boolean(verified)};
 })};
}

export function buildCfbdFittedWeek({fixtures,ppaPacket,priorPacket,schedulePacket,now=Date.now()}={}){
 const joined=attachCfbdCompletionEvidence(ppaPacket,schedulePacket);
 const projections=[],missing=[];
 const seen=new Set();
 for(const game of fixtures||[]){
  const id=String(game.id??game.eventId??'');
  if(!id||seen.has(id))throw Error('CFBD_FIXTURE_ID_INVALID');seen.add(id);
  const result=projectCfbdFittedRecovery(game,{ppaPacket:joined,priorPacket,now});
  if(result.ok)projections.push({eventId:id,game,result});
  else missing.push({eventId:id,reason:result.reason});
 }
 return {projections,missing,sourceCoverage:{fixtures:(fixtures||[]).length,projected:projections.length,missing:missing.length},canAuthorizeWager:false};
}
