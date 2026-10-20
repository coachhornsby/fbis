import { auditNhlMoneylineProbability } from './nhlUnifiedMoneylineShadow.js';
// A fitted, held-out NHL confidence artifact does not yet exist. Never accept
// caller-supplied approval/calibration flags as a substitute for that artifact.
export const NHL_GAME_CONFIDENCE_CALIBRATION = Object.freeze({
  version:'NHL-GAME-CONFIDENCE-v1',validated:false,n:0,bins:[],
  status:'AWAITING_INDEPENDENT_OUT_OF_TIME_CONFIDENCE_VALIDATION',
});
export function nhlGameConfidence(game={}) {
  if(String(game.sport||'').toLowerCase()!=='nhl')return null;
  const p=game.nhlProV2||game.challengers?.['NHL-PRO-v2'];
  const audit=auditNhlMoneylineProbability(game);
  const valid=Boolean(p?.ok&&p?.independent===true&&audit.ok);
  const goalies=p?.layers?.goalie||{};
  const confirmed=['home','away'].every(s=>goalies[s]?.selectionState==='PIT_CONFIRMED_STARTER');
  // Evidence completeness score, not hit probability. No market/gap inputs.
  const score=!valid?20:confirmed?69:55;
  return {score,source:'NHL_INDEPENDENT_EVIDENCE',headVersion:NHL_GAME_CONFIDENCE_CALIBRATION.version,
    calibrated:false,calibrationStatus:NHL_GAME_CONFIDENCE_CALIBRATION.status,
    evidence:{independentProjection:valid,confirmedGoalies:confirmed,reasons:audit.reasons},
    fiveStarEligible:false,canQualify:false,canAuthorizeWager:false};
}
