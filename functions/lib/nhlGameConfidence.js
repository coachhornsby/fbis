import { auditNhlMoneylineProbability } from './nhlUnifiedMoneylineShadow.js';
// A fitted, held-out NHL confidence artifact does not yet exist. Never accept
// caller-supplied approval/calibration flags as a substitute for that artifact.
export const NHL_GAME_CONFIDENCE_CALIBRATION = Object.freeze({
  version:'NHL-GAME-CONFIDENCE-v1',validated:false,n:0,bins:[],
  status:'AWAITING_INDEPENDENT_OUT_OF_TIME_CONFIDENCE_VALIDATION',
});
/**
 * Every score this head can emit. Until a fitted out-of-time confidence artifact
 * exists, NHL confidence is an evidence-completeness ladder with three rungs, so
 * the top of the display scale is 69 and not 100. Presentation layers read
 * NHL_GAME_CONFIDENCE_SCORE_CEILING instead of assuming a five-star scale, which
 * is what previously let a capped 3-star rating read as "three out of five".
 */
export const NHL_GAME_CONFIDENCE_SCORES = Object.freeze({
  NO_INDEPENDENT_PROJECTION: 20,
  INDEPENDENT_PROJECTION: 55,
  INDEPENDENT_PROJECTION_WITH_CONFIRMED_GOALIES: 69,
});

export const NHL_GAME_CONFIDENCE_SCORE_CEILING = Math.max(...Object.values(NHL_GAME_CONFIDENCE_SCORES));

export function nhlGameConfidence(game={}) {
  if(String(game.sport||'').toLowerCase()!=='nhl')return null;
  const p=game.nhlProV2||game.challengers?.['NHL-PRO-v2'];
  const audit=auditNhlMoneylineProbability(game);
  const valid=Boolean(p?.ok&&p?.independent===true&&audit.ok);
  const goalies=p?.layers?.goalie||{};
  const confirmed=['home','away'].every(s=>goalies[s]?.selectionState==='PIT_CONFIRMED_STARTER');
  // Evidence completeness score, not hit probability. No market/gap inputs.
  const score=!valid?NHL_GAME_CONFIDENCE_SCORES.NO_INDEPENDENT_PROJECTION
    :confirmed?NHL_GAME_CONFIDENCE_SCORES.INDEPENDENT_PROJECTION_WITH_CONFIRMED_GOALIES
    :NHL_GAME_CONFIDENCE_SCORES.INDEPENDENT_PROJECTION;
  return {score,source:'NHL_INDEPENDENT_EVIDENCE',headVersion:NHL_GAME_CONFIDENCE_CALIBRATION.version,
    calibrated:false,calibrationStatus:NHL_GAME_CONFIDENCE_CALIBRATION.status,
    scoreCeiling:NHL_GAME_CONFIDENCE_SCORE_CEILING,
    evidence:{independentProjection:valid,confirmedGoalies:confirmed,reasons:audit.reasons},
    fiveStarEligible:false,canQualify:false,canAuthorizeWager:false};
}
