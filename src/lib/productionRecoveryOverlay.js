// Put verified pregame research scores into the existing FBIS card view-model.
// Past, expired, wrong-team and wrong-time projections never become today's headline.
import {privateProjectionFor} from './privateBoardProjection.js';
import {privateFourSportProjectionFor} from '../../functions/lib/privateFourSportProjection.js';

export function overlayVerifiedResearchScores(game,{cbbPacket=null,sportPacket=null,clock=Date.now()}={}){
 if(!game||!['cbb','nfl','nba','cfb'].includes(game.sport))return game;
 const source=game.sport==='cbb'?privateProjectionFor(game,cbbPacket,clock):privateFourSportProjectionFor(game,sportPacket,clock);
 if(!source||source.expired||source.started)return game;
 const p=game.sport==='cbb'?source.primary:source.projection;
 const away=game.sport==='cbb'?p.away:p.awayScore,home=game.sport==='cbb'?p.home:p.homeScore;
 const modelId=p.modelId,modelVersion=p.modelVersion||cbbPacket?.version||'RESEARCH';
 if(![away,home].every(Number.isFinite))return game;
 return {
  ...game,
  projectionUnavailable:false,pureProjectionAvailable:true,projectionKind:'FBIS',
  projectionState:'RESEARCH_ONLY',projectionMaturity:'RESEARCH',publicationStatus:'RESEARCH_PUBLISHABLE',
  canQualify:false,canAuthorizeWager:false,bettingAllowed:false,qualificationBlocked:true,
  noPlayReason:'Private model research only; markets and qualification are unavailable.',
  recoveryVerifiedProjection:{
    awayScore:away,homeScore:home,margin:p.margin,total:p.total,
    modelId,modelVersion:String(modelVersion),expiresAt:game.sport==='cbb'?cbbPacket.expiresAt:sportPacket.expiresAt,
    sourceCapturedAt:game.sport==='cbb'?cbbPacket?.captures?.kenpom:source.sourceCapturedAt,
    attribution:game.sport==='cbb'?(p.attribution||'KenPom-based provisional research'):source.modelAuthority||sportPacket?.modelAuthority||'Frozen research'
  },
  model:{...game.model,projAway:away,projHome:home,projMargin:p.margin,projTotal:p.total,projectionKind:'FBIS',maturity:'RESEARCH',id:modelId,version:modelVersion},
  researchProjection:{away,home,modelId,modelVersion,independent:true,marketInformed:false,maturity:'RESEARCH',sourceCapturedAt:game.sport==='cbb'?cbbPacket?.captures?.kenpom:source.sourceCapturedAt},
 };
}
