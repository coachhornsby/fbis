// Public, minimal projection summaries derived from independently owned FBIS models.
// Never expose provider payloads, private research files, markets, account data, or tokens.
import {PRIVATE_RECOVERY_SPORTS,validateFourSportPacket} from './privateFourSportProjection.js';

export const PUBLIC_MODEL_IDS=Object.freeze({
  nfl:'NFL-TEAM-FORM-v0',
  nba:'NBA-FBIS-v1',
  cfb:'CFB-SCORE-FORM-RESEARCH',
});
const permitted=sport=>PRIVATE_RECOVERY_SPORTS.includes(sport)&&Boolean(PUBLIC_MODEL_IDS[sport]);
function summaryEvent(e,sport){
  if(e.projection.modelId!==PUBLIC_MODEL_IDS[sport])return null;
  return {eventId:e.eventId,date:e.date,start:e.start,homeId:e.homeId,awayId:e.awayId,
    sourceCapturedAt:e.sourceCapturedAt,canAuthorizeWager:false,
    projection:{homeScore:e.projection.homeScore,awayScore:e.projection.awayScore,
      margin:e.projection.margin,total:e.projection.total,modelId:e.projection.modelId,
      modelVersion:e.projection.modelVersion}};
}
export function publicProjectionSummary(privatePacket,{sport,date}={}){
  if(!permitted(sport))throw Error('PUBLIC_SPORT_NOT_ALLOWED');
  const p=validateFourSportPacket(privatePacket,{sport,date});
  const events=p.events.map(e=>summaryEvent(e,sport)).filter(Boolean);
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
  if(packet.events.some(e=>e.projection.modelId!==PUBLIC_MODEL_IDS[sport]))throw Error('NON_PUBLIC_MODEL');
  return packet;
}
