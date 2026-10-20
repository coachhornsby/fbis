import {loadPropFixturesAndPlayers} from './propResearchData.js';
import {loadCapturedKalshiProps} from './kalshiPlayerPropCollector.js';
import {verifyNhlSourceScope} from './nhlOfficialScopeVerification.js';
const ROOT='player-props/official/v1/';
async function nhlRead(url,fetchImpl){
 const r=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8500)});
 if(!r.ok)throw Error('HTTP_'+r.status);
 return r.json();
}
/** Source-certifies bounded NHL outcome identities. Does NOT approve Kalshi settlement. */
export async function discoverNhlSourceVerifiedScopes(env,{now=new Date(),fetchImpl=fetch,maxContracts=16}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put||!env?.DB?.prepare)
  return {ok:false,reason:'SOURCE_BINDINGS_MISSING'};
 const start=now.getTime(),games=[],players=[],diagnostics=[];
 for(let i=0;i<2;i++){
  const date=new Date(start+i*86400000).toISOString().slice(0,10);
  const context=await loadPropFixturesAndPlayers(env,{start:date+'T00:00:00.000Z',end:new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString(),sport:'nhl'});
  games.push(...context.games);players.push(...context.players);diagnostics.push(...context.diagnostics);
 }
 if(diagnostics.length)return {ok:false,reason:'CANONICAL_FIXTURE_OR_ROSTER_COVERAGE_FAILED',diagnostics};
 const captured=await loadCapturedKalshiProps(env,{games,players,sport:'nhl',now:start});
 if(captured.error)return {ok:false,reason:captured.error};
 const contracts=[...new Map(captured.rows.filter(r=>r.side==='yes').map(r=>[r.contractId,r])).values()]
  .slice(0,Math.min(16,Math.max(1,maxContracts)));
 const scheduleCache=new Map(),rosterCache=new Map(),scopes=[],rejected=[];
 for(const c of contracts){
  const date=String(c.start_time||'').slice(0,10),team=String(c.team||'');
  try{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!(/^[A-Z]{3}$/.test(team))){
    rejected.push({contractId:c.contractId,reason:'FIXTURE_DATE_OR_TEAM_UNKNOWN'});continue;
   }
   if(!scheduleCache.has(date))scheduleCache.set(date,await nhlRead('https://api-web.nhle.com/v1/schedule/'+date,fetchImpl));
   if(!rosterCache.has(team))rosterCache.set(team,await nhlRead('https://api-web.nhle.com/v1/roster/'+team+'/current',fetchImpl));
   const checked=verifyNhlSourceScope(c,scheduleCache.get(date),rosterCache.get(team),{observedAt:now.toISOString()});
   if(checked.ok)scopes.push(checked.scope);
   else rejected.push({contractId:c.contractId,reason:checked.reason});
  }catch{rejected.push({contractId:c.contractId,reason:'NHL_OFFICIAL_SOURCE_UNAVAILABLE'});}
 }
 if(!scopes.length)return {ok:false,reason:'NO_INDEPENDENTLY_VERIFIED_SCOPES',
  considered:contracts.length,rejected,canAuthorizeWager:false};
 const key=ROOT+'nhl-scopes.json';
 let previous;
 try{const r=await env.ARCHIVE.get(key);previous=r?await r.json():null;}
 catch{return {ok:false,reason:'PREVIOUS_MANIFEST_UNREADABLE'};}
 if(previous&&previous.generatedBy!=='FBIS_NHL_OFFICIAL_SOURCE_VERIFIER')
  return {ok:false,reason:'EXTERNAL_CERTIFICATION_MANIFEST_EXISTS'};
 const retained=(previous?.scopes||[]).filter(s=>s?.identityBasis==='NHL_OFFICIAL_SCHEDULE_AND_ROSTER'&&
  Number.isFinite(Date.parse(s.sourceFixtureStart))&&Date.parse(s.sourceFixtureStart)>start-3*86400000);
 const unique=new Map([...retained,...scopes].map(s=>[[s.canonicalEventId,s.canonicalPlayerId,s.stat].join(':'),s]));
 const manifest={version:1,certified:true,certificationScope:'NHL_OUTCOME_IDENTITY_ONLY',
  generatedBy:'FBIS_NHL_OFFICIAL_SOURCE_VERIFIER',verifiedAt:now.toISOString(),
  scopes:[...unique.values()].slice(-64),canQualify:false,canAuthorizeWager:false};
 try{await env.ARCHIVE.put(key,JSON.stringify(manifest));
  const receipt=await env.ARCHIVE.get(key);if(!receipt)throw Error('READBACK');
  const check=await receipt.json();
  if(check.generatedBy!==manifest.generatedBy||check.verifiedAt!==manifest.verifiedAt)throw Error('READBACK');
 }catch{return {ok:false,reason:'MANIFEST_WRITE_OR_READBACK_FAILED'};}
 return {ok:true,considered:contracts.length,newlyVerified:scopes.length,manifestScopes:manifest.scopes.length,
  rejected,canQualify:false,canAuthorizeWager:false};
}
