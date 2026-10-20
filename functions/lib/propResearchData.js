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
    modelAsOf:p.featureCutoffTimestamp||p.asOf||null,independent:true,modelStatus:'RESEARCH_PROJECTION',
    availabilityStatus:p.availabilityStatus||'UNKNOWN',features:p.featureEvidence||p.shotEnvironment||null,
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
   independent:true,modelStatus:p.modelStatus,availabilityStatus:p.availabilityStatus,features:p.features,validationStatus:p.validationStatus,
   projectionDelta:p.fbis_projection-m.line,reasons:[...m.reasons.filter(r=>r!=='MODEL_UNAVAILABLE'),'THRESHOLD_CALIBRATION_REQUIRED']};
 });
 return [...rows,...models.filter(p=>!used.has(p.id))];
}
