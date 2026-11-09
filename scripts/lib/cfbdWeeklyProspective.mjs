// Private prospective evidence only. No score inference, fitting or live-model promotion.
import{createHash}from'node:crypto';
import{CFB_TIER3_FEATURE_COLUMNS}from'../../functions/lib/cfbTier3FeatureRegistry.js';
import{publicModelAllowed}from'../../functions/lib/publicFourSportProjection.js';
import{validateFourSportPacket}from'../../functions/lib/privateFourSportProjection.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function buildCfbdWeeklyProspective({snapshot,fixtures,baselinePackets,createdAt=new Date().toISOString()}={}){
 const freeze=Date.parse(createdAt),receipt=Date.parse(snapshot?.receivedAt);
 if(!Number.isFinite(freeze)||!Number.isFinite(receipt)||receipt>freeze||!/^[a-f0-9]{64}$/.test(snapshot?.sourceSha256||'')||snapshot?.season!==2026||snapshot?.week!==11)throw Error('WEEKLY_PROSPECTIVE_SOURCE_INVALID');
 const fixtureMap=new Map();for(const g of fixtures||[]){if(fixtureMap.has(String(g.id)))throw Error('DUPLICATE_FIXTURE');fixtureMap.set(String(g.id),g);}
 const baselines=new Map();for(const p of baselinePackets||[]){validateFourSportPacket(p,{sport:'cfb',date:p.date});if(Date.parse(p.generatedAt)>freeze)throw Error('BASELINE_FROM_FUTURE');for(const e of p.events){if(baselines.has(String(e.eventId)))throw Error('DUPLICATE_BASELINE');baselines.set(String(e.eventId),{event:e,packetSha256:hash(p),generatedAt:p.generatedAt,expiresAt:p.expiresAt});}}
 const rows=[],held=[],seen=new Set();
 for(const g of snapshot.games||[]){
  const id=String(g.gameId);if(seen.has(id))throw Error('DUPLICATE_UPLOAD_GAME');seen.add(id);
  const f=fixtureMap.get(id),start=Date.parse(f?.start);
  let reason=!f?'AUTHORITATIVE_FIXTURE_MISSING':!Number.isFinite(start)||receipt>=start||freeze>=start?'NOT_FROZEN_PREGAME':g.identityStatus!=='matched'?'UPLOAD_IDENTITY_UNRESOLVED':g.homeCanonicalId!==`cfb-${f.home?.espnId}`||g.awayCanonicalId!==`cfb-${f.away?.espnId}`?'UPLOAD_FIXTURE_SIDES_MISMATCH':Boolean(g.neutralSite)!==f.neutralSite?'NEUTRAL_SITE_MISMATCH':null;
  if(reason){held.push({eventId:id,reason});continue;}
  const features={};
  if(Object.keys(g.features||{}).some(k=>!CFB_TIER3_FEATURE_COLUMNS.includes(k)))throw Error('UNREGISTERED_OR_MARKET_PREDICTOR');
  for(const k of CFB_TIER3_FEATURE_COLUMNS){if(typeof g.features?.[k]!=='number'||!Number.isFinite(g.features[k]))throw Error('WEEKLY_FEATURE_MISSING:'+k);features[k]=g.features[k];}
  const b=baselines.get(id),e=b?.event;
  const matched=e&&e.homeId===g.homeCanonicalId&&e.awayId===g.awayCanonicalId&&Date.parse(e.start)===start&&e.projection.modelId==='CFB-FBIS-v2'&&publicModelAllowed(e,'cfb',{requireProvenance:true});
  rows.push({eventId:id,date:f.date,start:f.start,homeId:g.homeCanonicalId,awayId:g.awayCanonicalId,neutralSite:f.neutralSite,sourceRowSha256:g.rowSha256,features,marketReference:{spread:g.openingSpread,observedAt:null,usableAsPredictor:false},baseline:matched?{projection:{...e.projection},sourceCapturedAt:e.sourceCapturedAt,provenance:e.provenance||null,generatedAt:b.generatedAt,expiresAt:b.expiresAt,packetSha256:b.packetSha256}:null,baselineState:matched?'FROZEN_COMPARATOR':'NO_MATCHED_FITTED_BASELINE',outcome:null,providerFeatureCutoffVerified:false,canInfluenceLiveProjection:false});
 }
 return{version:1,visibility:'PRIVATE_RESEARCH_ONLY',purpose:'PROSPECTIVE_FEATURE_VALIDATION',createdAt,sourceSha256:snapshot.sourceSha256,sourceReceivedAt:snapshot.receivedAt,fixtureManifestSha256:hash(fixtures),featureColumns:[...CFB_TIER3_FEATURE_COLUMNS],rows,held,coverage:{uploaded:snapshot.games.length,identityVerified:rows.length,pairedBaseline:rows.filter(r=>r.baseline).length,held:held.length},canInfluenceLiveProjection:false,canAuthorizeWager:false,trainingEligibility:'OUTCOMES_PENDING_AND_PROVIDER_CUTOFF_UNVERIFIED'};
}
