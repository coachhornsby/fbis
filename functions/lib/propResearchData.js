import {nhlModelTeamCode} from './nhlTeamCodes.js';
import { canonicalPlayerId } from './propProviderAdapters.js';
import { finitePropNumber as n } from './exchangePlayerProps.js';
import { resolveNbaResearchOwnerDb } from './nbaResearchOwnerDb.js';
import { deployedSportDbMode,hydrateCutoverApprovals,productSportDbHandle } from './databaseTopology.js';
import { PROP_SPORTS } from './exchangePlayerProps.js';
export const propTeamKey=(sport,value)=>sport==='nba'?({SA:'SAS',NY:'NYK',GS:'GSW',NO:'NOP'}[String(value).toUpperCase()]||String(value).toUpperCase()):sport==='nhl'?nhlModelTeamCode(value):String(value).toUpperCase();
export async function resolvePropResearchEnv(env,sport){
 if(sport==='nba')return resolveNbaResearchOwnerDb(env);
 if(deployedSportDbMode(env,sport)!=='sport')return {ok:!!env.DB?.prepare,db:env.DB,env,binding:'DB'};
 const scoped={...env,__fbisCutoverApprovals:new Map()};
 const approval=await hydrateCutoverApprovals(scoped,{sport});
 const owner=productSportDbHandle(scoped,sport);
 if(!approval.ok||!owner.productIoUsesSportDb||!owner.db?.prepare)return {ok:false,reason:owner.reason||approval.reason};
 return {ok:true,db:owner.db,env:{...scoped,DB:owner.db},binding:owner.binding};
}
export async function loadPropFixturesAndPlayers(env,{start,end,sport='all'}={}) {
 const diagnostics=[],games=[],players=[];
 if(sport==='all'){
  const contexts=await Promise.all(PROP_SPORTS.map(s=>loadPropFixturesAndPlayers(env,{start,end,sport:s})));
  return {games:contexts.flatMap(c=>c.games),players:contexts.flatMap(c=>c.players),diagnostics:contexts.flatMap(c=>c.diagnostics),owners:contexts.flatMap(c=>c.owners||[])};
 }
 const owner=await resolvePropResearchEnv(env,sport);
 if(!owner.ok||!owner.db?.prepare)return {games,players,diagnostics:[sport.toUpperCase()+'_OWNER_UNAVAILABLE:'+owner.reason]};
 env={...owner.env,DB:owner.db};
 if(!env.DB?.prepare)return {games,players,diagnostics:['DATABASE_UNBOUND']};
 try { games.push(...((await env.DB.prepare(`SELECT * FROM games WHERE julianday(start)>=julianday(?) AND julianday(start)<julianday(?) AND date=? ${sport==='all'?'':'AND sport=?'} ORDER BY start LIMIT 500`).bind(start,end,start.slice(0,10),...(sport==='all'?[]:[sport])).all()).results||[])); }catch{diagnostics.push('FIXTURE_READ_FAILED');}
 const tables={nba:['nba_player_state_profiles','as_of'],nfl:['nfl_player_profiles','updated_at'],nhl:['nhl_player_profiles','source_updated_at'],mlb:['mlb_player_state_profiles','updated_at']};
 for(const [s,[table,clock]]of Object.entries(tables)){
  if(sport!=='all'&&sport!==s)continue;
  const teamKeys=[...new Set(games.filter(g=>g.sport===s).flatMap(g=>[g.home_abbr,g.away_abbr]).filter(Boolean).flatMap(t=>{
   const v=String(t).toUpperCase(),canonical=propTeamKey(s,v);return [v,v.toLowerCase(),canonical,canonical.toLowerCase()];
  }))];
  if(!teamKeys.length)continue;
  try{ const rows=(await env.DB.prepare(`SELECT * FROM ${table} WHERE team_key IN (${teamKeys.map(()=>'?').join(',')}) AND julianday(${clock})>=julianday('now','-14 days') LIMIT 5000`).bind(...teamKeys).all()).results||[];
   for(const p of rows)players.push({...p,sport:s});
  }catch{diagnostics.push(`${s.toUpperCase()}_ROSTER_READ_FAILED`);}
 }
 return {games,players,diagnostics,owners:[{sport,binding:owner.binding}]};
}
export function independentPropRows(board,{now=Date.now()}={}) {
 const out=[];
 for(const g of board?.games||[]){
  if(!Number.isFinite(Date.parse(g.start))||Date.parse(g.start)<=now)continue;
  for(const p of g.playerProjectionRows||[]){
   if(p.independent!==true||p.marketInformed===true||n(p.fbisProjection)==null||!p.playerId||['OUT','IR','PUP','NFI','SUSPENDED'].includes(String(p.availabilityStatus||'').toUpperCase()))continue;
   const historyProvider=g.sport==='nfl'?'nflverse':g.sport==='nhl'?'nhl':g.sport==='mlb'?'mlb':'espn';
   const cid=canonicalPlayerId(g.sport,historyProvider,p.playerId);
   out.push({id:`model:${g.id}:${cid}:${p.market}`,sport:g.sport,canonicalEventId:String(g.id),canonicalPlayerId:cid,
    player_name:p.playerName,team:p.team,opponent:p.opponent||(propTeamKey(g.sport,p.team)===propTeamKey(g.sport,g.home?.abbr)?g.away?.abbr:g.home?.abbr),position:p.position,
    historyProvider,historyPlayerId:String(p.playerId),start_time:g.start,canonical_market:p.market,period:'full_game',
    line:null,provider:null,side:null,statSide:null,fbis_projection:n(p.fbisProjection),sigma:n(p.fbisSigma),
    modelId:p.modelId||g.playerProjectionStatus?.model||p.source,modelVersion:p.modelVersion||g.playerProjectionStatus?.version,
    modelAsOf:p.featureCutoffTimestamp||p.featureCutoff||p.stateAsOf||p.sourceObservedAt||p.asOf||g.playerProjectionStatus?.asOf||null,independent:true,modelStatus:'RESEARCH_PROJECTION',
    availabilityStatus:p.availabilityStatus||'UNKNOWN',features:p.featureEvidence||p.shotEnvironment||null,
    researchInputs:{role:p.targetRole,roleConfidence:p.roleConfidence,snapShare:p.snapShare,recent5:p.recent5,seasonAverage:p.seasonAverage,priorAverage:p.priorAverage,formBlend:p.formBlend,opponentMatchup:p.opponentMatchup,environmentFactor:p.environmentFactor,matchupFactor:p.matchupFactor,projectedMinutes:p.projectedMinutes,expectedInnings:p.expectedInnings,expectedPlateAppearances:p.expectedPlateAppearances,expectedBattersFaced:p.expectedBattersFaced,lineupState:p.lineupState,notes:p.notes},
    validationStatus:p.validationStatus||'CALIBRATION_PENDING',marketAvailable:false,identityVerified:true,purchaseAsk:null,
    reasons:[p.gateReason,'MARKET_UNAVAILABLE','THRESHOLD_CALIBRATION_REQUIRED'].filter(Boolean),canQualify:false,canAuthorizeWager:false});
  }
 }
 // E[X+Y] is the sum of independent model means. No covariance or probability is invented.
 const bases=new Map();for(const r of out)if(r.sport==='nba'){
  const key=[r.canonicalEventId,r.canonicalPlayerId,r.period,r.modelId,r.modelVersion,r.modelAsOf].join('|');
  if(!bases.has(key))bases.set(key,[]);bases.get(key).push(r);
 }
 for(const rows of bases.values())for(const [market,parts]of [['points_rebounds',['points','rebounds']],['points_assists',['points','assists']],['rebounds_assists',['rebounds','assists']]]){
  const first=rows[0];if(out.some(r=>r.canonicalEventId===first.canonicalEventId&&r.canonicalPlayerId===first.canonicalPlayerId&&r.canonical_market===market))continue;
  const terms=parts.map(m=>rows.filter(r=>r.canonical_market===m));if(terms.some(xs=>xs.length!==1))continue;
  const components=terms.map(xs=>xs[0]);
  out.push({...first,id:`model:${first.canonicalEventId}:${first.canonicalPlayerId}:${market}`,canonical_market:market,
   fbis_projection:Math.round(components.reduce((sum,r)=>sum+r.fbis_projection,0)*10)/10,sigma:null,
   modelId:'NBA-PLAYER-COMPOSITE-v1',modelVersion:first.modelVersion+'+sum-v1',validationStatus:'COMBINATION_COVARIANCE_PENDING',
   researchInputs:{...first.researchInputs,derivedFrom:parts,notes:'Sum of same-cutoff FBIS stat means. Joint uncertainty and threshold calibration are not inferred.'}});
 }
 return out;
}
export function joinIndependentPropModels(markets,models) {
 const used=new Set();
 const stat=v=>v==='pra'?'points_rebounds_assists':v;
 const modelKey=r=>[r.canonicalEventId,r.canonicalPlayerId,stat(r.canonical_market),r.period].join('|');
 const index=new Map();for(const p of models)if(p.independent!==false){const key=modelKey(p);if(!index.has(key))index.set(key,[]);index.get(key).push(p);}
 const rows=markets.map(m=>{const matches=index.get(modelKey(m))||[];
  if(matches.length!==1)return m;
  const p=matches[0];used.add(p.id);
  return {...m,fbis_projection:p.fbis_projection,sigma:p.sigma,modelId:p.modelId,modelVersion:p.modelVersion,modelAsOf:p.modelAsOf,
   independent:true,dataAcceptance:p.dataAcceptance,modelStatus:p.modelStatus,availabilityStatus:p.availabilityStatus,features:p.features,researchInputs:p.researchInputs,validationStatus:p.validationStatus,
   projectionDelta:p.fbis_projection-m.line,reasons:[...m.reasons.filter(r=>r!=='MODEL_UNAVAILABLE'),'THRESHOLD_CALIBRATION_REQUIRED']};
 });
 return [...rows,...models.filter(p=>!used.has(p.id))];
}

/** Use the persisted roster's explicit ESPN↔GSIS link, never a name-only model join. */
export function resolvePropModelIdentities(models, {players=[],games=[]}={}) {
 return models.map(m=>{
  if(m.sport!=='nfl'||m.historyProvider!=='nflverse')return m;
  const game=games.find(g=>String(g.id)===m.canonicalEventId);
  if(!game)return m;
  const candidates=players.filter(p=>{
   if(p.sport!=='nfl'||String(p.team_key).toUpperCase()!==String(m.team).toUpperCase()||
      ![game.home_abbr,game.away_abbr].some(t=>String(t).toUpperCase()===String(p.team_key).toUpperCase()))return false;
   try {const raw=JSON.parse(p.raw_json||'{}');return String(raw.roster?.id)===String(p.player_id)&&
    String(raw.usage?.id)===String(m.historyPlayerId)&&String(raw.usage?.team).toUpperCase()===String(m.team).toUpperCase();}catch{return false;}
  });
  if(candidates.length!==1)return m;
  const p=candidates[0];
  return {...m,canonicalPlayerId:canonicalPlayerId('nfl','espn',p.player_id),historyProvider:'espn',historyPlayerId:String(p.player_id),
   modelPlayerId:m.canonicalPlayerId,identityBasis:'PERSISTED_ROSTER_ESPN_GSIS_LINK'};
 }).map(m=>{
   const game=games.find(g=>String(g.id)===m.canonicalEventId);
   const parts=String(m.canonicalPlayerId||'').split(':');
   const exact=players.filter(p=>p.sport===m.sport&&String(p.player_id)===parts[2]&&propTeamKey(m.sport,p.team_key)===propTeamKey(m.sport,m.team));
   const fixtureTeam=game&&[game.home_abbr,game.away_abbr].some(t=>propTeamKey(m.sport,t)===propTeamKey(m.sport,m.team));
   return {...m,identityVerified:!!fixtureTeam&&exact.length===1&&parts[1]!=="nflverse",identityBasis:m.identityBasis||'EXACT_SPORT_ROSTER_AND_FIXTURE'};
  });
}
