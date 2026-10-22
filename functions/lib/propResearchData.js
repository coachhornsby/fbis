import { canonicalPlayerId } from './propProviderAdapters.js';
import { finitePropNumber as n } from './exchangePlayerProps.js';
export async function loadPropFixturesAndPlayers(env,{start,end,sport='all'}={}) {
 const diagnostics=[],games=[],players=[];
 if(!env.DB?.prepare)return {games,players,diagnostics:['PRIMARY_UNBOUND']};
 try { games.push(...((await env.DB.prepare(`SELECT * FROM games WHERE julianday(start)>=julianday(?) AND julianday(start)<julianday(?) AND date=? ${sport==='all'?'':'AND sport=?'} ORDER BY start LIMIT 500`).bind(start,end,start.slice(0,10),...(sport==='all'?[]:[sport])).all()).results||[])); }catch{diagnostics.push('FIXTURE_READ_FAILED');}
 const tables={nba:['nba_player_state_profiles','as_of'],nfl:['nfl_player_profiles','updated_at'],nhl:['nhl_player_profiles','source_updated_at'],mlb:['mlb_player_state_profiles','updated_at']};
 for(const [s,[table,clock]]of Object.entries(tables)){
  if(sport!=='all'&&sport!==s)continue;
  try{ const rows=(await env.DB.prepare(`SELECT * FROM ${table} WHERE julianday(${clock})>=julianday('now','-14 days') LIMIT 2000`).all()).results||[];
   for(const p of rows)players.push({...p,sport:s});
  }catch{diagnostics.push(`${s.toUpperCase()}_ROSTER_READ_FAILED`);}
 }
 return {games,players,diagnostics};
}
export function independentPropRows(board,{now=Date.now()}={}) {
 const out=[];
 for(const g of board?.games||[]){
  if(!Number.isFinite(Date.parse(g.start))||Date.parse(g.start)<=now)continue;
  for(const p of g.playerProjectionRows||[]){
   if(p.independent!==true||p.marketInformed===true||n(p.fbisProjection)==null||!p.playerId)continue;
   const historyProvider=g.sport==='nfl'?'nflverse':g.sport==='nhl'?'nhl':g.sport==='mlb'?'mlb':'espn';
   const cid=canonicalPlayerId(g.sport,historyProvider,p.playerId);
   out.push({id:`model:${g.id}:${cid}:${p.market}`,sport:g.sport,canonicalEventId:String(g.id),canonicalPlayerId:cid,
    player_name:p.playerName,team:p.team,opponent:p.opponent||(p.team===g.home?.abbr?g.away?.abbr:g.home?.abbr),position:p.position,
    historyProvider,historyPlayerId:String(p.playerId),start_time:g.start,canonical_market:p.market,period:'full_game',
    line:null,provider:null,side:null,statSide:null,fbis_projection:n(p.fbisProjection),sigma:n(p.fbisSigma),
    modelId:g.playerProjectionStatus?.model||p.source,modelVersion:g.playerProjectionStatus?.version||p.modelVersion,
    modelAsOf:p.featureCutoffTimestamp||p.featureCutoff||p.asOf||g.playerProjectionStatus?.asOf||null,independent:true,modelStatus:'RESEARCH_PROJECTION',
    availabilityStatus:p.availabilityStatus||'UNKNOWN',features:p.featureEvidence||p.shotEnvironment||null,
    researchInputs:{role:p.targetRole,roleConfidence:p.roleConfidence,snapShare:p.snapShare,recent5:p.recent5,seasonAverage:p.seasonAverage,priorAverage:p.priorAverage,formBlend:p.formBlend,opponentMatchup:p.opponentMatchup,environmentFactor:p.environmentFactor,matchupFactor:p.matchupFactor,projectedMinutes:p.projectedMinutes,notes:p.notes},
    validationStatus:p.validationStatus||'CALIBRATION_PENDING',marketAvailable:false,identityVerified:true,purchaseAsk:null,
    reasons:[p.gateReason,'MARKET_UNAVAILABLE','THRESHOLD_CALIBRATION_REQUIRED'].filter(Boolean),canQualify:false,canAuthorizeWager:false});
  }
 }
 return out;
}
export function joinIndependentPropModels(markets,models) {
 const used=new Set();
 const stat=v=>v==='pra'?'points_rebounds_assists':v;
 const rows=markets.map(m=>{const matches=models.filter(p=>p.canonicalEventId===m.canonicalEventId&&p.canonicalPlayerId===m.canonicalPlayerId&&stat(p.canonical_market)===stat(m.canonical_market)&&p.period===m.period&&p.independent!==false);
  if(matches.length!==1)return m;
  const p=matches[0];used.add(p.id);
  return {...m,fbis_projection:p.fbis_projection,sigma:p.sigma,modelId:p.modelId,modelVersion:p.modelVersion,modelAsOf:p.modelAsOf,
   independent:true,modelStatus:p.modelStatus,availabilityStatus:p.availabilityStatus,features:p.features,researchInputs:p.researchInputs,validationStatus:p.validationStatus,
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
 });
}
