// Public, minimal projection summaries derived from independently owned FBIS models.
// Never expose provider payloads, private research files, markets, account data, or tokens.
import FITTED_CFB from '../../data/models/cfb-fbis-v2-fitted-aa.js';
import {PRIVATE_RECOVERY_SPORTS,validateFourSportPacket} from './privateFourSportProjection.js';

export const PUBLIC_MODEL_IDS=Object.freeze({
  nfl:'NFL-TEAM-FORM-v0',
  nba:'NBA-FBIS-v1',
  cfb:'CFB-SCORE-FORM-RESEARCH',
});
const permitted=sport=>PRIVATE_RECOVERY_SPORTS.includes(sport)&&Boolean(PUBLIC_MODEL_IDS[sport]);
const advancedNfl=e=>e.projection?.modelId==='NFL-PRO-v1'&&e.projection.modelVersion==='v1.2.1'&&e.sourceLabel==='nflverse verified current-season inputs; NFL-PRO-v1.2.1 research; no wagering'&&e.nflVerifiedInput?.source==='nflverse'&&e.nflVerifiedInput.canAuthorizeWager===false&&e.nflVerifiedInput.observedAt===e.sourceCapturedAt&&/^[a-f0-9]{64}$/.test(e.nflVerifiedInput.snapshotSha256||'');
export function publicModelAllowed(e,sport,{requireProvenance=false}={}){
 const p=e?.projection;
 if(sport==='nfl'&&p?.modelId==='NFL-PRO-v1'&&p.modelVersion==='v1.2.1')return !requireProvenance||advancedNfl(e);
 if(p?.modelId===PUBLIC_MODEL_IDS[sport])return !requireProvenance||/^ESPN (verified|actual) /.test(String(e.sourceLabel||''));
 if(sport!=='cfb'||p?.modelId!=='CFB-FBIS-v2'||p.modelVersion!==FITTED_CFB.version)return false;
 if(!requireProvenance)return true;
 const v=e.provenance;
 return e.sourceLabel==='CFBD verified per-game PPA and frozen prior; CFB-FBIS-v2'&&v?.featureContract===FITTED_CFB.featureContract&&
  v?.coefficientsSha256===FITTED_CFB.sourceArtifacts.fittedCoefficientsFinalSha256&&v?.priorSourceSeason===2025&&
  /^[a-f0-9]{64}$/.test(v?.ppaResponseSha256||'')&&Array.isArray(v?.homeGameIds)&&v.homeGameIds.length>=3&&Array.isArray(v?.awayGameIds)&&v.awayGameIds.length>=3;
}
function summaryEvent(e,sport,packet){
  // The recovery producer uses ESPN-derived form/box scores only for these ids.
  // An altered or unverifiable source label cannot be silently made public.
  if(!publicModelAllowed(e,sport,{requireProvenance:true}))return null;
  return {eventId:e.eventId,date:e.date,start:e.start,homeId:e.homeId,awayId:e.awayId,
    sourceCapturedAt:e.sourceCapturedAt,canAuthorizeWager:false,
    ...(sport==='nfl'&&advancedNfl(e)&&e.nflDirectionalResearch?{nflDirectionalResearch:structuredClone(e.nflDirectionalResearch)}:{}),
    ...(sport==='nfl'&&advancedNfl(e)&&e.nflPlayerResearch?{nflPlayerResearch:structuredClone(e.nflPlayerResearch)}:{}),
    ...(sport==='nfl'&&packet.eventGeneratedAt?.[String(e.eventId)]?{generatedAt:packet.eventGeneratedAt[String(e.eventId)]}:{}),
    projection:{homeScore:e.projection.homeScore,awayScore:e.projection.awayScore,
      margin:e.projection.margin,total:e.projection.total,modelId:e.projection.modelId,
      modelVersion:e.projection.modelVersion}};
}
export function publicProjectionSummary(privatePacket,{sport,date}={}){
  if(!permitted(sport))throw Error('PUBLIC_SPORT_NOT_ALLOWED');
  const p=validateFourSportPacket(privatePacket,{sport,date});
  const events=p.events.map(e=>summaryEvent(e,sport,p)).filter(Boolean);
  return {version:1,visibility:'PUBLIC_MODEL_SUMMARY',sport,date,
    generatedAt:p.generatedAt,expiresAt:p.expiresAt,
    modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,
    canQualify:false,marketQuotesAvailable:false,events};
}
export function validatePublicProjectionSummary(packet,{sport,date}={}){
  if(!packet||packet.visibility!=='PUBLIC_MODEL_SUMMARY'||packet.sport!==sport||
    packet.date!==date||packet.canQualify!==false||packet.marketQuotesAvailable!==false)
    throw Error('INVALID_PUBLIC_MODEL_SUMMARY');
  const privateEquivalent={...packet,visibility:'PRIVATE_PERSONAL_ANALYSIS'};
  validateFourSportPacket(privateEquivalent,{sport,date});
  if(packet.events.some(e=>!publicModelAllowed(e,sport)))throw Error('NON_PUBLIC_MODEL');
  return packet;
}
