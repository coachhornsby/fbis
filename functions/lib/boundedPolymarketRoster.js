import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {POLY_ROSTER_STAGE_JOB,POLY_ROSTER_PUBLISH_JOB} from '../../services/account-budget/executionJobs.mjs';
import {buildStreamRosterManifest,validateStreamRoster,STREAM_ROSTER_KEY} from '../../services/polymarket-us-stream/boundedSession.mjs';
export const ROSTER_SPORTS=Object.freeze(['nfl','cfb','cbb','nba','wnba','mlb','nhl','soccer','tennis','npb','kbo']);
export const candidateKey=sport=>'market-sources/polymarket-us/stream-roster/candidates-v2/'+sport+'.json';
const fresh=(row,now)=>Number.isFinite(Date.parse(row?.collected_at))&&Date.parse(row.collected_at)<=now&&now-Date.parse(row.collected_at)<900000;
const writeOptions=prior=>{if(prior&&(typeof prior.etag!=='string'||!prior.etag.length))throw Error('MISSING_ROSTER_VERSION');return {onlyIf:prior?{etagMatches:prior.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}};};
export async function stageBoundedStreamCandidates(env,{sport,candidates,now=Date.now()}={}){
 if(!ROSTER_SPORTS.includes(sport)||!Array.isArray(candidates)||!candidates.length||candidates.length>50||candidates.some(r=>r.sport!==sport))throw Error('INVALID_CANDIDATE_SCOPE');
 // A producer's receipt time is preserved. Republishing cannot freshen quotes.
 const validated=buildStreamRosterManifest(candidates,{now});
 env=await beginJobExecution(env,POLY_ROSTER_STAGE_JOB);
 const prior=await env.ARCHIVE.get(candidateKey(sport));let previous=[];
 if(prior){const old=await prior.json();if(old.version!==2||old.sport!==sport||!Array.isArray(old.roster)||old.roster.length>50)throw Error('INVALID_CANDIDATE_STORE');previous=old.roster.filter(r=>fresh(r,now));if(previous.some(r=>r.sport!==sport))throw Error('CANDIDATE_SPORT_MISMATCH');}
 const merged=buildStreamRosterManifest([...previous,...validated.roster],{now});
 const value={...merged,sport,expiresAt:new Date(Math.min(now+900000,...merged.roster.map(r=>Date.parse(r.collected_at)+900000))).toISOString()};
 const saved=await env.ARCHIVE.put(candidateKey(sport),JSON.stringify(value),writeOptions(prior));
 if(!saved)throw Error('ROSTER_UPDATE_CONFLICT');
 return {ok:true,sport,selected:value.roster.length,complete:false,canQualify:false,canAuthorizeWager:false};
}
export async function publishBoundedStreamRoster(env,{now=Date.now(),reservationId}={}){
 env=await beginJobExecution(env,POLY_ROSTER_PUBLISH_JOB,{reservationId});
 const previous=await env.ARCHIVE.head(STREAM_ROSTER_KEY),candidates=[],sources=[];
 // Fixed eleven reads. Never list an archive prefix or query D1.
 for(const sport of ROSTER_SPORTS){
  const object=await env.ARCHIVE.get(candidateKey(sport));
  if(!object){sources.push({sport,status:'MISSING',selected:0});continue;}
  const value=await object.json();
  if(value.version!==2||value.source!=='Polymarket US'||value.sport!==sport||!Array.isArray(value.roster)||value.roster.length>50)throw Error('INVALID_CANDIDATE_STORE');
  if(!Number.isFinite(Date.parse(value.capturedAt))||Date.parse(value.capturedAt)>now||!Number.isFinite(Date.parse(value.expiresAt)))throw Error('INVALID_CANDIDATE_CLOCK');
  if(Date.parse(value.expiresAt)<=now){sources.push({sport,status:'EXPIRED',selected:0});continue;}
  const rows=value.roster.filter(r=>fresh(r,now));
  if(rows.some(r=>r.sport!==sport))throw Error('CANDIDATE_SPORT_MISMATCH');
  if(rows.length)validateStreamRoster({...value,capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+900000).toISOString(),roster:rows},now);
  candidates.push(...rows);sources.push({sport,status:rows.length?'CURRENT':'STALE',selected:rows.length});
 }
 const manifest=candidates.length?buildStreamRosterManifest(candidates,{now}):{version:2,source:'Polymarket US',capturedAt:new Date(now).toISOString(),roster:[],complete:false,canQualify:false,canAuthorizeWager:false};
 manifest.expiresAt=new Date(Math.min(now+900000,...manifest.roster.map(r=>Date.parse(r.collected_at)+900000))).toISOString();
 manifest.sources=sources;manifest.coverageScope='BOUNDED_CAPTURED_CANDIDATES_ONLY';manifest.complete=false;
 const saved=await env.ARCHIVE.put(STREAM_ROSTER_KEY,JSON.stringify(manifest),writeOptions(previous));
 if(!saved)throw Error('ROSTER_UPDATE_CONFLICT');
 return {ok:true,status:manifest.roster.length?'PUBLISHED':'NO_FRESH_CONTRACTS',selected:manifest.roster.length,sources,canQualify:false,canAuthorizeWager:false};
}
