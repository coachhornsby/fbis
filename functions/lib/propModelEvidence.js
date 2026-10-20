import nfl from '../../data/models/nfl-player-props-v3-validation.json' with {type:'json'};
import nflCal from '../../data/models/nfl-prop-market-calibration-v2.json' with {type:'json'};
import nhl from '../../data/models/nhl-player-pro-v2-validation.json' with {type:'json'};
import nba from '../../data/models/nba-player-prop-v1-validation.json' with {type:'json'};
export function propModelEvidence(sport,market) {
 if(sport==='nfl')return {modelId:nfl.modelId,validatedAt:nfl.validatedAt,design:nfl.design,sample:nfl.sample,
  projection:nfl.marketCalibration[market]||null,globalMetrics:nfl.bestGlobal,
  calibration:nflCal.markets[market]||null,calibrationVersion:nflCal.calibrationVersion,limitations:nfl.limitations,
  exchangeContractValidated:false,canAuthorizeWager:false};
 if(sport==='nhl')return {modelId:nhl.modelId,version:nhl.version,validatedAt:nhl.generatedAt,projection:nhl.aggregate?.projection,
  threshold:nhl.aggregate?.threshold,marketValidation:nhl.marketValidation?.[market]||null,conditionalOnActive:nhl.conditionalOnActive,
  conditionalOnConfirmedStarter:nhl.conditionalOnConfirmedStarter,exchangeContractValidated:false,canAuthorizeWager:false};
 if(sport==='nba')return {modelId:nba.modelId,version:nba.version,status:nba.decision,reason:nba.reason,
  dataPolicy:'RIGHTS_CLEARED_PLAYER_FEED_REQUIRED',exchangeContractValidated:false,canAuthorizeWager:false};
 return {status:'SPORT_MARKET_VALIDATION_NOT_ATTACHED',exchangeContractValidated:false,canAuthorizeWager:false};
}
