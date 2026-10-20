/**
 * Construct auditable NHL official-outcome *candidates* from existing exact
 * contract matches. A candidate never self-certifies and cannot activate
 * the production official collector without separate source review.
 */
const stats=new Set(['shots_on_goal','goals','assists','points','saves']);
const digits=x=>typeof x==='string'&&/^\d{8,10}$/.test(x);
export function buildNhlOfficialScopeCandidates(contracts=[],{capturedAt}={}){
 const seen=new Set(),scopes=[],rejected=[];
 if(!Number.isFinite(Date.parse(capturedAt)))return {ok:false,reason:'CAPTURE_TIMESTAMP_MISSING',scopes,rejected,certified:false};
 for(const c of contracts){
  if(c?.sport!=='nhl')continue;
  const eventId=String(c.canonicalEventId||''),playerId=String(c.historyPlayerId||'');
  const suffix=String(c.canonicalPlayerId||'');
  const reasons=[];
  if(c.provider!=='Kalshi'||c.identityVerified!==true)reasons.push('CONTRACT_IDENTITY_UNVERIFIED');
  if(!validGameId(eventId)||!validPlayerId(playerId)||suffix!=='nhl:nhl:'+playerId)reasons.push('EXACT_NHL_SOURCE_IDS_REQUIRED');
  if(!stats.has(c.canonical_market)||c.period!=='full_game')reasons.push('STAT_SCOPE_UNSUPPORTED');
  if(!c.contractId||!c.providerEventId||!c.providerPlayerId)reasons.push('PROVIDER_REFERENCE_MISSING');
  const observedAt=c.collectedAt||capturedAt;
  const started=Date.parse(c.start_time);
  if(!Number.isFinite(started)||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>=started)reasons.push('PROSPECTIVE_CONTRACT_REQUIRED');
  if(reasons.length){rejected.push({contractId:c.contractId||null,reasons});continue;}
  const key=[eventId,playerId,c.canonical_market].join(':');
  if(seen.has(key))continue;seen.add(key);
  scopes.push({
   gameId:eventId,playerId,canonicalEventId:eventId,canonicalPlayerId:suffix,
   stat:c.canonical_market,period:'full_game',identityVerified:false,
   candidateIdentityMatched:true,reviewRequired:true,
   evidence:{provider:c.provider,contractId:c.contractId,providerEventId:c.providerEventId,
    providerPlayerId:c.providerPlayerId,sourceCapturedAt:observedAt}
  });
 }
 return {ok:true,version:1,certified:false,scopes,rejected,
  canQualify:false,canAuthorizeWager:false};
}
