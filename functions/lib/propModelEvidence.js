import { NFL_PROP_VALIDATION as nfl,NFL_PROP_CALIBRATION as nflCal,NHL_PROP_VALIDATION as nhl,NBA_PROP_VALIDATION as nba } from "../../data/models/prop-research-evidence.js";
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
