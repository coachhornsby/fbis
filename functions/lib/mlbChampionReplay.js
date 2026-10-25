import {sha256Hex} from './sha256Hex.js';
import {projectMlbDeep,MLB_DEEP_VERSION} from './mlbDeepModel.js';
import {MLB_PLAYER_PROP_MODEL_VERSION} from './mlbPlayerPropModel.js';
import {predictRetrospectiveK,countCalibration} from './mlbRetrospectiveKFit.js';
const avg=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
export function frozenCurrentForecasts(freeze,grade){
 const {sourceHash,...data}=freeze;if(sha256Hex(JSON.stringify(data))!==sourceHash||grade.freezeHash!==sourceHash||grade.gameId!==freeze.gameId||freeze.modelVersion!==MLB_DEEP_VERSION)throw Error('CURRENT_FREEZE_IDENTITY_OR_HASH');
 const current=projectMlbDeep(freeze.inputs);if(!current.ok)throw Error('CURRENT_ENGINE_UNAVAILABLE');
 for(const side of ['home','away'])if(current.pitcherKs?.[side]?.projection!==freeze.predictions.combined.pitcherKs?.[side]?.projection)throw Error('CURRENT_ENGINE_REPLAY_MISMATCH');
 const players=(freeze.playerForecasts||[]).filter(p=>p.position==='P'?p.market==='strikeouts':['hits','total_bases','home_runs'].includes(p.market));
 return players.map(p=>({id:sourceHash+':'+p.playerId+':'+p.market,event_id:freeze.gameId,event_date:grade.gameId===freeze.gameId?freeze.gameStart.slice(0,10):null,event_start_at:freeze.gameStart,player_id:p.playerId,market:p.position==='P'?'pitcher_k':p.market,position:p.position,model_version:p.modelVersion,projection:p.projection,checkpoint:freeze.checkpoint,source_observed_at:p.sourceObservedAt,state_as_of:p.sourceObservedAt,projection_snapshot_at:freeze.capturedAt,currentVersion:true,freezeHash:sourceHash}));
}
export function normalizeReplayForecasts(archived,current){
 const rows=[...archived.map(r=>({...r,market:r.market==='strikeouts'?'pitcher_k':r.market,currentVersion:false})),...current],seen=new Set();
 return rows.map(r=>{const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.event_start_at));const date=r.currentVersion?localDate:r.event_date;
  const key=[r.event_id,r.player_id,r.market,r.model_version].join(':');if(seen.has(key))throw Error('DUPLICATE_REPLAY_FORECAST');seen.add(key);
  const start=Date.parse(r.event_start_at),capture=Date.parse(r.projection_snapshot_at),source=Date.parse(r.source_observed_at),state=Date.parse(r.state_as_of);
  if(!/^\d+$/.test(String(r.event_id))||!/^\d+$/.test(String(r.player_id))||!Number.isFinite(r.projection)||r.projection<0||![start,capture,source,state].every(Number.isFinite)||capture>=start||source>capture||state>capture)throw Error('INVALID_OR_POSTGAME_PRODUCTION_FORECAST');
  return {...r,event_date:date};
 });
}
export function validateReplayModels(report){
 const models={pitcher_k:report,...report.hitterModels};
 for(const market of ['pitcher_k','hits','total_bases','home_runs']){const r=models[market];if(!r?.model||sha256Hex(JSON.stringify(r.model))!==r.modelHash||r.model.trainedThroughExclusive>r.model.selectedBefore)throw Error('REPLAY_MODEL_HASH_OR_CUTOFF');}
 return models;
}
export function pairFrozenForecast(forecast,row,fit){
 if(!row)return {excluded:'NO_ELIGIBLE_LAGGED_DESIGN_ROW'};
 if(row.gameId!==String(forecast.event_id)||row.playerId!==String(forecast.player_id)||row.date!==forecast.event_date)throw Error('PAIRED_IDENTITY_MISMATCH');
 if(row.classification!=='RETROSPECTIVE'||row.date<fit.model.selectedBefore||row.priorSourceDates.some(d=>d>=row.date)||row.features.length!==6||!row.features.every(Number.isFinite)||!Number.isFinite(row.baseline)||!(row.baseline>0))throw Error('LEAKING_OR_INVALID_REPLAY_ROW');
 if(!Number.isFinite(row.target)||row.target<0)return {excluded:'OFFICIAL_TARGET_MISSING'};
 if(forecast.actual_value!=null&&Number.isFinite(forecast.actual_value)&&forecast.actual_value!==row.target)return {excluded:'ARCHIVED_SETTLEMENT_DISAGREES_WITH_OFFICIAL_FINAL'};
 return {pair:{gameId:row.gameId,playerId:row.playerId,date:row.date,scope:row.scope,market:forecast.market,championVersion:forecast.model_version,currentVersion:forecast.currentVersion,checkpoint:forecast.checkpoint,champion:forecast.projection,candidate:predictRetrospectiveK(fit.model,row),target:row.target,modelHash:fit.modelHash,sourceHash:row.sourceHash,featureHash:sha256Hex(JSON.stringify({baseline:row.baseline,features:row.features,priorSourceDates:row.priorSourceDates})),baseline:row.baseline,features:row.features,priorSourceDates:row.priorSourceDates,productionSnapshotAt:forecast.projection_snapshot_at,productionEvidenceId:forecast.id}};
}
function kFitScores(rows,predict){if(!rows.length)return null;const xs=rows.map(r=>({y:r.target,mu:predict(r)}));return {n:rows.length,distinctGames:new Set(rows.map(r=>r.gameId)).size,mae:avg(xs.map(r=>Math.abs(r.mu-r.y))),rmse:Math.sqrt(avg(xs.map(r=>(r.mu-r.y)**2))),bias:avg(xs.map(r=>r.mu-r.y)),poissonDeviance:avg(xs.map(r=>{const mu=Math.max(1e-9,r.mu);return 2*(r.y>0?r.y*Math.log(r.y/mu)-(r.y-mu):mu);} ))};}
function interval(rows){const games=new Map();for(const r of rows){const xs=games.get(r.gameId)||[];xs.push(Math.abs(r.candidate-r.target)-Math.abs(r.champion-r.target));games.set(r.gameId,xs);}const xs=[...games.values()].map(avg),mean=avg(xs),n=xs.length,se=n>1?Math.sqrt(xs.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)/n):null;return {distinctGames:n,meanCandidateMinusChampion:mean,lo:n>=30?mean-1.96*se:null,hi:n>=30?mean+1.96*se:null,method:'GAME_CLUSTERED_NORMAL_APPROXIMATION',insufficientForInterval:n<30};}
export function summarizeChampionReplay(pairs,{excluded=[],corpus={},inputHashes={}}={}){
 const groups=new Map(),seen=new Set();for(const r of pairs){const key=[r.gameId,r.playerId,r.market,r.championVersion].join(':');if(seen.has(key))throw Error('DUPLICATE_PAIRED_PLAYER_GAME');seen.add(key);const c=[r.currentVersion?'CURRENT':'LEGACY',r.market,r.championVersion,r.modelHash].join(':');if(!groups.has(c))groups.set(c,[]);groups.get(c).push(r);}
 const cohorts=[...groups].map(([cohort,rows])=>{const lines={pitcher_k:[2.5,4.5,6.5],hits:[.5,1.5],total_bases:[.5,1.5,2.5],home_runs:[.5]}[rows[0].market];return {cohort,market:rows[0].market,championVersion:rows[0].championVersion,currentVersion:rows[0].currentVersion,modelHash:rows[0].modelHash,distinctDates:new Set(rows.map(r=>r.date)).size,champion:kFitScores(rows,r=>r.champion),candidate:kFitScores(rows,r=>r.candidate),pairedGameError:interval(rows),countProbabilityDiagnostics:{assumption:'COMMON_POISSON_LINK_FOR_BOTH_MEANS_NOT_EXECUTABLE_MARKET_PROBABILITIES',champion:countCalibration(rows,r=>r.champion,lines),candidate:countCalibration(rows,r=>r.candidate,lines)},segments:Object.fromEntries(['regular','postseason'].map(scope=>{const rs=rows.filter(r=>r.scope===scope);return [scope,{champion:kFitScores(rs,r=>r.champion),candidate:kFitScores(rs,r=>r.candidate)}];})),forecastPromotionReady:false};});
 return {version:'mlb-frozen-champion-replay-v1',classification:'RETROSPECTIVE_PAIRED_FITTED_VS_FROZEN_PRODUCTION',createdAt:new Date().toISOString(),inputHashes,corpus,cohorts,excluded,pairedRows:pairs.length,distinctGames:new Set(pairs.map(r=>r.gameId)).size,decision:'INSUFFICIENT_CURRENT_CHAMPION_HISTORY',canPromote:false,limitations:['Fitted predictions are retrospectively reconstructed from strictly prior-day outcomes, not falsely labeled as captured before the historical game.','Current and legacy production versions are separate cohorts; repeated players and checkpoints do not create independent games.','Only games with archived pregame production forecasts can support an exact frozen-production comparison. Missing historic Pal/weather/profile states are not invented.','Production pitcher-K replay is checked against the saved current-engine inputs; current hitter comparisons use the actually frozen production outputs.','Count calibration uses a common Poisson link as a model diagnostic; prices, wager EV, ROI and economic qualification are outside this comparison.','This archive comparison follows inspection of the prior holdout report; it is follow-up evidence, not a newly untouched test set.']};
}
