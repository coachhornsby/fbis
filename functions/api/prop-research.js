import {loadPropResearchResult} from '../lib/propResearchResults.js';
import { loadPolymarketGlobalNba } from '../lib/polymarketGlobalNbaProps.js';
import { readNbaFrozenMarketLines } from '../lib/nbaPropMarketFreeze.js';
import { loadNbaFrozenPregameModels } from '../lib/nbaFrozenPregameModels.js';
import { nbaActualForMarket } from '../lib/nbaOfficialPropTotals.js';
import { onRequestGet as nbaOfficialActualsGet } from './nba-prop-actuals.js';
import { propModelEvidence } from '../lib/propModelEvidence.js';
import { loadPropFixturesAndPlayers,independentPropRows,resolvePropModelIdentities,resolvePropResearchEnv,propTeamKey } from '../lib/propResearchData.js';
import { loadCapturedKalshiProps } from '../lib/kalshiPlayerPropCollector.js';
import { loadCanonicalPropHistory } from '../lib/propHistoryResearch.js';
import { loadNflVerseFeatures } from '../lib/nflVerseFeed.js';
import { buildSlate } from '../lib/slateEngine.js';
import { chicagoDayBounds } from '../lib/chicagoDayBounds.js';
import { PROP_SPORTS } from '../lib/exchangePlayerProps.js';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'private,max-age=60'}});
export async function onRequestGet({env,request}) {
 const u=new URL(request.url),sport=u.searchParams.get('sport'),day=u.searchParams.get('date'),id=u.searchParams.get('playerId')||'',eventId=u.searchParams.get('eventId'),market=u.searchParams.get('market');
 if(!PROP_SPORTS.includes(sport)||!id.startsWith(sport+':')||!eventId||!market)return json({ok:false,error:'Exact sport, player, event and stat required'},400);
 let bounds;try{bounds=chicagoDayBounds(day);}catch{return json({ok:false,error:'Invalid date'},400);}
 const owner=await resolvePropResearchEnv(env,sport);
 if(!owner.ok)return json({ok:false,error:'Sport data owner unavailable'},503);
 const historyEnv={...owner.env,DB:owner.db};
 const context=await loadPropFixturesAndPlayers(env,{...bounds,start:bounds.start,end:bounds.end,sport});
 const game=context.games.find(g=>String(g.id)===eventId);
 if(!game)return json({ok:false,error:'Canonical event not found'},404);
 const [,provider,playerId]=id.split(':');
 const fixtureTeams=[game.home_abbr,game.away_abbr];
 // NBA public fixture abbreviations SA/NY map to verified SAS/NYK
 // roster identities only after exact game lookup above.
 const keys=[...fixtureTeams,...fixtureTeams.map(t=>propTeamKey(sport,t))];
 const rosterMatches=context.players.filter(p=>String(p.player_id)===playerId&&keys.some(t=>String(t).toUpperCase()===String(p.team_key).toUpperCase()));
 let player=rosterMatches.length===1?rosterMatches[0]:null;
 if(provider==='nflverse'&&sport==='nfl'){
  const feed=await loadNflVerseFeatures(env,{forceNetwork:false});const match=Object.values(feed.playersByTeam||{}).flat().find(p=>String(p.id)===playerId&&[game.home_abbr,game.away_abbr].includes(p.team));
  if(match)player={player_id:playerId,player_name:match.name,team_key:match.team,position:match.position};
 }
 if(!player||!['nflverse','nhl','mlb','espn'].includes(provider))return json({ok:false,error:'Player/event roster identity not verified'},422);
 const contractId=u.searchParams.get('contractId');
 const started=Date.parse(game.start)<=Date.now();
 const needContracts=u.searchParams.get('historyOnly')!=='1';
 const captured=needContracts&&!started?await loadCapturedKalshiProps(env,{...context,sport,seriesFilter:contractId?.split('-')[0]}):{rows:[]};
 const gamma=sport==='nba'&&needContracts&&!started?await loadPolymarketGlobalNba(env,{day}):{rows:[]};
 const frozen=sport==='nba'&&started&&needContracts?await Promise.all(['Kalshi','Polymarket'].map(provider=>
   readNbaFrozenMarketLines(env,{provider,date:day}))):[];
 const contracts=[...captured.rows,...gamma.rows,...frozen.flatMap(x=>x.rows)]
  .filter(r=>r.canonicalEventId===eventId&&r.canonicalPlayerId===id&&r.canonical_market===market);
 const contract=contracts.find(c=>c.contractId===u.searchParams.get('contractId')&&c.side===(u.searchParams.get('contractSide')||'yes'))||null;
 const historyPromise=loadCanonicalPropHistory(historyEnv,{sport,provider,playerId,market,profile:player,line:contract?.line??null,asOf:new Date(Math.min(Date.now(),Date.parse(game.start))).toISOString()});
 // No request-provided projection, probability, price or threshold enters this estimate.
 let model=null,modelState='UNAVAILABLE';
 if(u.searchParams.get('historyOnly')!=='1')try {
  if(sport==='nba'&&started){
   const frozenModels=await loadNbaFrozenPregameModels(env,{date:day,players:context.players});
   model=frozenModels.rows.find(p=>p.canonicalEventId===eventId&&p.canonicalPlayerId===id&&p.canonical_market===(market==='pra'?'points_rebounds_assists':market))||null;
   modelState=model?'FROZEN_PREGAME_RESEARCH':'FROZEN_PREGAME_FORECAST_MISSING';
  }else{
   const slate=await buildSlate(sport,day,{...env,caches:typeof caches==='undefined'?null:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false});
   model=resolvePropModelIdentities(independentPropRows(slate),context).find(p=>p.canonicalEventId===eventId&&p.canonicalPlayerId===id&&(p.canonical_market===market||(p.canonical_market==='pra'&&market==='points_rebounds_assists')))||null;
   modelState=model?'RESEARCH_PROJECTION':(slate.games||[]).find(g=>String(g.id)===eventId)?.playerProjectionStatus?.state||'UNAVAILABLE';
  }
 }catch{modelState='MODEL_DELIVERY_UNAVAILABLE';}
 const history=await historyPromise;
 let stored={};try{stored=JSON.parse(player.raw_json||player.profile_json||'{}');}catch{}
 const profile={role:player.role_label||player.rotation_role||stored.rotationRole,depthRank:player.depth_rank,jersey:player.jersey||player.sweater_number||stored.jersey,practice:player.practice_state,injury:player.injury_detail,snapShare:player.last_known_snap_share,nextGen:stored.usage?.ngs||null,recentForm:stored.usage?.recent5||null,position:player.position||stored.latestEvidence?.position||stored.position,availability:player.health_state||player.availability_state||player.status||'UNKNOWN',source:player.state_source||player.source,asOf:player.state_source_timestamp||player.state_source_updated_at||player.source_updated_at||player.as_of,
  expectedMinutes:player.expected_minutes,expectedSnapShare:player.expected_snap_share,evLine:player.ev_line,powerPlayUnit:player.pp_unit,iceTimeSeconds:player.rolling_toi_seconds,roleConfidence:player.role_confidence??player.state_confidence,batSide:stored.batSide,pitchHand:stored.pitchHand,rosterStatus:player.roster_status||stored.rosterStatus,starterProbability:player.starter_probability,expectedInnings:model?.researchInputs?.expectedInnings,expectedPlateAppearances:model?.researchInputs?.expectedPlateAppearances};
 let results=u.searchParams.get('historyOnly')==='1'?{status:'NOT_REQUESTED'}:await loadPropResearchResult(env,{sport,eventId,playerId:id,market,eventStart:game.start});
 if(sport==='nba'&&started&&u.searchParams.get('historyOnly')!=='1'){
  try{
   const link=new URL('/api/nba-prop-actuals',request.url);
   link.searchParams.set('date',day);link.searchParams.set('eventId',eventId);
   const response=await nbaOfficialActualsGet({env,request:new Request(link)});
   if(response.ok){
    const payload=await response.json(),official=(payload.rows||[]).find(r=>
      r.eventId===eventId&&r.canonicalPlayerId===id&&r.officialVerified===true);
    const actual=nbaActualForMarket(official,market);
    if(actual!=null&&model?.historicalPregame===true)
     results={status:'OFFICIAL_RESULT_JOINED',actual,projection:model.fbis_projection,
      forecastError:Number((model.fbis_projection-actual).toFixed(2)),
      frozenPrediction:model.modelAsOf,source:official.source,modelVersion:model.modelVersion,
      recordedWager:false,canAuthorizeWager:false};
   }
  }catch{}
 }
 return json({ok:true,modelEvidence:propModelEvidence(sport,market),canonicalPlayerId:id,canonicalEventId:eventId,player:{name:player.player_name,team:player.team_key,...profile},market,model,modelState,history,
  matchup:{opponent:propTeamKey(sport,player.team_key)===propTeamKey(sport,game.home_abbr)?game.away_abbr:game.home_abbr,venue:game.venue_name||game.venue,home:propTeamKey(sport,player.team_key)===propTeamKey(sport,game.home_abbr),inputs:model?.researchInputs||null},
  contracts,selectedContract:contract,calibration:{status:'THRESHOLD_CALIBRATION_UNVERIFIED',probability:null,reason:'Projection validation is separate from exchange threshold and settlement calibration.'},
  results,canQualify:false,canAuthorizeWager:false});
}
