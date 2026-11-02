/** Standalone private comparison: never substitutes for KenPom primary or CBBD confirmation. */
import{cbbTorvikRatingsV1}from'./cbbRatings.js';import{cbbFixtureKey}from'./cbbProjectionPacket.js';
export function buildTorvikPrivateComparison({games,providerRows,observedAt,asOf}){
 const now=Date.parse(asOf),capture=Date.parse(observedAt);if(!Number.isFinite(now)||!Number.isFinite(capture)||capture>now||now-capture>6*3600000)throw Error('TORVIK_CAPTURE_STALE_OR_FUTURE');
 const ratings=new Map();for(const r of providerRows){const p=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;if(r.season!==2027||r.provider!=='torvik'||p.season!==2027||p.canonicalId!==r.teamId||r.observedAt!==observedAt||ratings.has(r.teamId))throw Error('TORVIK_PROVIDER_BINDING');ratings.set(r.teamId,p);}
 const seen=new Set();const events=games.filter(g=>g.sport==='cbb').map(g=>{
  if(seen.has(g.id))throw Error('DUPLICATE_EVENT');seen.add(g.id);const reasons=[];
  const start=Date.parse(g.start),scoreboard=Date.parse(g.capturedAt);
  if(!Number.isFinite(start)||start<=now||g.status!=='scheduled')reasons.push('NOT_PREGAME');
  if(!Number.isFinite(scoreboard)||scoreboard>now||now-scoreboard>5*60000)reasons.push('SCOREBOARD_STALE_OR_FUTURE');
  if(typeof g.neutralSite!=='boolean')reasons.push('VENUE_UNVERIFIED');
  if(g.officialSchedule?.remainingHolds?.length)reasons.push(...g.officialSchedule.remainingHolds);
  const h=ratings.get('cbb-'+g.home?.espnId),a=ratings.get('cbb-'+g.away?.espnId);if(!h||!a)reasons.push('CURRENT_PROVIDER_TEAM_UNAVAILABLE');
  let comparison=null;if(!reasons.length){const p=cbbTorvikRatingsV1(g,{homeAdjOe:h.adjOe,homeAdjDe:h.adjDe,homeTempo:h.tempo,awayAdjOe:a.adjOe,awayAdjDe:a.adjDe,awayTempo:a.tempo});if(p.ok)comparison={home:p.home,away:p.away,margin:p.margin,total:p.total,possessions:p.possessions,modelId:p.modelId};else reasons.push('RATINGS_INVALID');}
  return {eventId:g.id,fixtureKey:cbbFixtureKey(g),date:g.date,start:g.start,homeName:g.home?.name,awayName:g.away?.name,comparison,reasons,stage:'PRIVATE_TORVIK_COMPARISON_ONLY',availability:'UNKNOWN',primaryKenpom:null,cbbdConfirmation:null,canQualify:false,canAuthorizeWager:false};
 });
 return {visibility:'PRIVATE_RESEARCH',generatedAt:asOf,observedAt,expiresAt:new Date(capture+6*3600000).toISOString(),events,summary:{fixtures:events.length,comparisons:events.filter(e=>e.comparison).length,qualified:0},canAuthorizeWager:false};
}
