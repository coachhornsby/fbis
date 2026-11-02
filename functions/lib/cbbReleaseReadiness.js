/** Private offline readiness. No network, model changes, persistence or order authority. */
import {cbbFixtureKey} from './cbbProjectionPacket.js';
const HOUR=3600000;
export function validEvidenceTime(observedAt,publishedAt,asOf,start,ttl=6*HOUR){
 const [o,p,n,s]=[observedAt,publishedAt,asOf,start].map(Date.parse);
 return [o,p,n,s].every(Number.isFinite)&&p<=o&&o<=n&&o<s&&n-o<=ttl;
}
/** Roster membership is never an active/healthy designation. Official host allowlist is supplied by the reviewed operator catalog. */
export function cbbAvailability(game,roster,records,asOf,officialHosts=[]){
 const teams=['cbb-'+game.home?.espnId,'cbb-'+game.away?.espnId];
 const members=roster.filter(p=>teams.includes(p.canonicalTeamId));
 const missingTeams=teams.filter(t=>!members.some(p=>p.canonicalTeamId===t));
 const byId=new Map();
 for(const p of members){if(byId.has(String(p.espnPlayerId)))throw Error('DUPLICATE_ROSTER_PLAYER');byId.set(String(p.espnPlayerId),p);}
 let rejected=0;const accepted=new Map();
 for(const r of records.filter(r=>r.eventId===game.id)){
  const player=byId.get(String(r.playerId));let url;
  try{url=new URL(r.sourceUrl);}catch{rejected++;continue;}
  if(!player||r.teamId!==player.canonicalTeamId||r.fixtureKey!==cbbFixtureKey(game)||r.sourceClass!=='OFFICIAL_TEAM'||url.protocol!=='https:'||url.username||url.password||!officialHosts.includes(url.hostname)||!['ACTIVE','OUT','DOUBTFUL','QUESTIONABLE'].includes(r.status)||!validEvidenceTime(r.observedAt,r.publishedAt,asOf,game.start)){
   rejected++;continue;
  }
  const list=accepted.get(String(r.playerId))||[];list.push(r);accepted.set(String(r.playerId),list);
 }
 const players=members.map(p=>{
  const evidence=accepted.get(String(p.espnPlayerId))||[];
  const states=new Set(evidence.map(r=>r.status));
  return {playerId:String(p.espnPlayerId),teamId:p.canonicalTeamId,status:states.size>1?'CONFLICT':states.size===1?[...states][0]:'UNKNOWN',sourceUrls:[...new Set(evidence.map(r=>r.sourceUrl))]};
 });
 const unknown=players.filter(p=>p.status==='UNKNOWN').length,conflicts=players.filter(p=>p.status==='CONFLICT').length;
 return {state:!members.length?'ROSTER_UNAVAILABLE':missingTeams.length?'INCOMPLETE_ROSTER':conflicts?'CONFLICT':unknown===members.length?'UNKNOWN':unknown?'PARTIAL':'SOURCE_COVERAGE_COMPLETE',players,unknown,conflicts,missingTeams,rejectedRecords:rejected,canAdjustModel:false};
}
export function buildCbbReleaseReadiness({games,projectionPacket,marketObservations=[],availabilityRecords=[],roster=[],officialHosts=[],asOf}){
 const now=Date.parse(asOf);if(!Number.isFinite(now))throw Error('INVALID_AS_OF');
 const sourceEvents=projectionPacket?.events||[];
 const projections=new Map(sourceEvents.map(e=>[String(e.eventId),e]));
 if(projections.size!==sourceEvents.length)throw Error('DUPLICATE_PROJECTION_EVENT');
 const ids=new Set();const events=[];
 for(const g of games.filter(g=>g.sport==='cbb')){
  if(ids.has(g.id))throw Error('DUPLICATE_EVENT');ids.add(g.id);
  const reasons=[];const key=cbbFixtureKey(g),p=projections.get(g.id);
  if(!Number.isFinite(Date.parse(g.start))||Date.parse(g.start)<=now||g.status!=='scheduled')reasons.push('NOT_PREGAME');
  if(!p||p.fixtureKey!==key)reasons.push('PROJECTION_FIXTURE_MISMATCH');
  const generated=Date.parse(projectionPacket?.generatedAt),expiry=Date.parse(projectionPacket?.expiresAt);
  if(!Number.isFinite(generated)||!Number.isFinite(expiry)||generated>now||expiry<=generated||expiry<=now)reasons.push('PROJECTION_EXPIRED_OR_FUTURE');
  if(!p?.primary)reasons.push('PRIMARY_UNAVAILABLE');
  if(!p?.confirmationAvailable)reasons.push('CURRENT_CBBD_CONFIRMATION_UNAVAILABLE');
  if(!p?.nativeTotal)reasons.push('NATIVE_TOTAL_UNAVAILABLE');
  if(p?.reasons?.includes('COMPETITION_CLASSIFICATION_UNVERIFIED')||g.officialSchedule?.remainingHolds?.includes('COMPETITION_CLASSIFICATION_UNVERIFIED'))reasons.push('COMPETITION_CLASSIFICATION_UNVERIFIED');
  const a=cbbAvailability(g,roster,availabilityRecords,asOf,officialHosts);
  if(a.state!=='SOURCE_COVERAGE_COMPLETE')reasons.push('AVAILABILITY_'+a.state);
  // This gate examines execution evidence only; it never grants execution permission.
  const quotes=marketObservations.filter(q=>q.canonicalEventId===g.id&&q.fixtureKey===key&&q.sourcePaginationComplete===true&&q.freshForExecution===true&&validEvidenceTime(q.capturedAt,q.capturedAt,asOf,g.start,5*60000)&&Number.isFinite(q.yesBid)&&Number.isFinite(q.yesAsk)&&q.yesBid>=0&&q.yesAsk<=1&&q.yesBid<=q.yesAsk&&Number.isFinite(q.yesAskSize)&&q.yesAskSize>0&&q.rulesPrimary&&q.contractId);
  if(!quotes.length)reasons.push('CURRENT_COMPLETE_MARKET_EVIDENCE_UNAVAILABLE');
  events.push({eventId:g.id,date:g.date,start:g.start,fixtureKey:key,homeName:g.home?.name,awayName:g.away?.name,state:reasons.length?'BLOCKED':'EVIDENCE_REVIEW_REQUIRED',reasons:[...new Set(reasons)],availability:a,qualifyingMarketObservations:quotes.length,canAuthorizeWager:false});
 }
 return {version:1,generatedAt:asOf,visibility:'PRIVATE_OPERATIONS',events,summary:{fixtures:events.length,pregame:events.filter(e=>!e.reasons.includes('NOT_PREGAME')).length,blocked:events.filter(e=>e.state==='BLOCKED').length,evidenceReviewRequired:events.filter(e=>e.state==='EVIDENCE_REVIEW_REQUIRED').length},productionDeploymentAuthorized:false,canAuthorizeWager:false};
}
