// Bounded recovery evidence. No provider access, model changes or persistence.
export function createRecoverySourceBudget({ESPN=134,KenPom=1}={}) {
 const limits={ESPN,KenPom},counts={ESPN:0,KenPom:0};
 return {counts,limits,reserve(kind){
  if(!Object.hasOwn(limits,kind))throw Error('SOURCE_KIND_NOT_ALLOWED');
  if(counts[kind]>=limits[kind])throw Error('SOURCE_CALL_BUDGET_EXCEEDED');
  counts[kind]++;
 }};
}
export function recoveryCoverage(target,events,expiresAt) {
 const expiry=Date.parse(expiresAt);
 const projected=new Set(events.map(e=>String(e.eventId)));
 const missing=target.filter(g=>!projected.has(String(g.id))).map(g=>String(g.id));
 const expiring=events.filter(e=>!Number.isFinite(expiry)||Date.parse(e.start)>=expiry).map(e=>String(e.eventId));
 return {state:!target.length?'NO_SCHEDULED_GAMES':!events.length?'UNAVAILABLE':missing.length||expiring.length?'PARTIAL':'COMPLETE',
  scheduled:target.length,projected:events.length,missingEventIds:missing,
  expiresBeforeStartEventIds:expiring,expiresAt:expiresAt||null,canAuthorizeWager:false};
}
