import { buildSlate,resolveSlateDate } from '../lib/slateEngine.js';
import { independentPropRows,loadPropFixturesAndPlayers,resolvePropModelIdentities } from '../lib/propResearchData.js';
import { chicagoDayBounds } from '../lib/chicagoDayBounds.js';
import { buildPropAcceptance,assessPropModel } from '../lib/propAcceptance.js';
import { PROP_SPORTS } from '../lib/exchangePlayerProps.js';
import { loadNbaFrozenPregameModels } from '../lib/nbaFrozenPregameModels.js';
import { loadIndexedFrozenForecasts } from '../lib/fbisFrozenModelDelivery.js';
export async function onRequestGet({env,request}) {
 const u=new URL(request.url),sport=u.searchParams.get('sport')||'nfl',date=resolveSlateDate(u.searchParams.get('date')||'',{maxPast:sport==='nba'?14:0,maxFuture:7});
 if(!PROP_SPORTS.includes(sport)||!date.ok)return Response.json({ok:false,error:'Invalid sport or date'}, {status:400});
 try {
  const chicagoToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',
   year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  // Past NBA days MUST be sourced only from persisted pretip forecasts.
  // Re-running today's projection model on historical data risks hindsight.
  const pastNbaDate=sport==='nba'&&date.date<chicagoToday;
  const slate=pastNbaDate?{games:[]}:await buildSlate(sport,date.date,{...env,caches:typeof caches==='undefined'?null:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false});
  const context=await loadPropFixturesAndPlayers(env,{...chicagoDayBounds(date.date),sport});
  // Live/final NBA games must retain source-saved PRETIP frozen forecasts.
  // independentPropRows deliberately excludes games after tip; never fabricate
  // an in-play "pregame" estimate or lift a post-tip snapshot into the board.
  const upcoming=resolvePropModelIdentities(independentPropRows(slate),context);
  // Fill ONLY missing exact player/event/stat identities with source-hash
  // verified frozen forecasts. Never displace live independent projections.
  const indexed=await loadIndexedFrozenForecasts(env,{
   sport,date:date.date,games:context.games,players:context.players});
  const identity=r=>[r.canonicalEventId,r.canonicalPlayerId,
   r.canonical_market==='pra'?'points_rebounds_assists':r.canonical_market,r.period].join('|');
  const existing=new Set(upcoming.map(identity));
  for(const row of indexed.rows)if(!existing.has(identity(row))){
   upcoming.push(row);existing.add(identity(row));
  }
  let archived=[];
  let historicalDiagnostics=[];
  if(sport==='nba'){
   const freeze=await loadNbaFrozenPregameModels(env,{date:date.date,players:context.players});
   archived=freeze.rows.filter(r=>Date.parse(r.start_time)<=Date.now());
   historicalDiagnostics=freeze.diagnostics;
  }
  const rows=[...upcoming,...archived].map(r=>({
   ...r,
   dataAcceptance:assessPropModel(r,r.historicalPregame
     ? {now:Math.min(Date.now(),Date.parse(r.start_time)-1)}
     : {}),
  }));
  return Response.json({ok:true,sport,date:date.date,rows,acceptance:buildPropAcceptance({models:rows,sport,date:date.date,sourceDiagnostics:[...context.diagnostics,...historicalDiagnostics,
     ...(['SOURCE_HASH_VERIFIED','NO_CAPTURE_INDEX'].includes(indexed.status)?[]:['FROZEN_'+indexed.status])]}),modelStates:(slate.games||[]).map(g=>({eventId:g.id,...g.playerProjectionStatus})),canQualify:false,canAuthorizeWager:false}, {headers:{'cache-control':'public,max-age=120'}});
 }catch{return Response.json({ok:false,rows:[],error:'MODEL_DELIVERY_UNAVAILABLE'},{status:503});}
}
