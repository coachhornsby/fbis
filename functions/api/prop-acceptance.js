import {prepareNbaPropHistory} from '../lib/propHistoryResearch.js';
import {SDV_NBA_PREFIX} from '../lib/nbaSdvHistoryShadow.js';
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {capturePropForecastJob} from '../lib/propForecastCaptureJob.js';
import { onRequestGet as exchange } from './exchange-player-props.js';
import { onRequestGet as projections } from './prop-projections.js';
import { buildPropAcceptance } from '../lib/propAcceptance.js';
import { PROP_SPORTS } from '../lib/exchangePlayerProps.js';
/** Operator-only report surface; no new banners or badges on the betting board. */
export async function onRequestGet({env,request}) {
 const url=new URL(request.url),sport=url.searchParams.get('sport'),date=url.searchParams.get('date');
 if(!PROP_SPORTS.includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return Response.json({ok:false,error:'One sport and an exact date are required'},{status:400});
 const params=new URLSearchParams({sport,date}),args={env,request:new Request(url.origin+'/api/prop-projections?'+params)};
 const [modelResponse,marketResponse]=await Promise.all([projections(args),exchange({...args,request:new Request(url.origin+'/api/exchange-player-props?'+params)})]);
 const [model,market]=await Promise.all([modelResponse.json(),marketResponse.json()]);
 const diagnostics=[...(model.ok?[]:['MODEL_DELIVERY_UNAVAILABLE']),...(market.ok?[]:['MARKET_DELIVERY_UNAVAILABLE']),...(market.identityDiagnostics||[]),
  ...(market.diagnostics||[]).filter(d=>d.status==='READ_FAILED'||d.truncated).map(d=>d.store+':'+(d.truncated?'TRUNCATED':d.status))];
 diagnostics.push(...(market.collectorCoverage||[]).filter(c=>['PARTIAL','STALE','READ_FAILED'].includes(c.status)).map(c=>c.series+':'+c.status));
 const historyByPlayer={};
 if(sport==='nba')try{
  const file=await env.ARCHIVE?.get(SDV_NBA_PREFIX+'snapshot.json'),read=file?prepareNbaPropHistory(await file.json()):null;
  for(const r of model.rows||[]){
   const history=read&&r.canonicalPlayerId?.startsWith('nba:espn:')?read({playerId:r.canonicalPlayerId.split(':')[2],market:r.canonical_market,asOf:new Date(Math.min(Date.now(),Date.parse(r.start_time))).toISOString()}):null;
   const stat=r.canonical_market==='pra'?'points_rebounds_assists':r.canonical_market;
   (historyByPlayer[r.canonicalPlayerId]||={})[stat]=history||{available:false,reason:'EXACT_PLAYER_STAT_HISTORY_UNAVAILABLE'};
  }
 }catch{diagnostics.push('NBA_HISTORY_SNAPSHOT_READ_FAILED');}
 const report=buildPropAcceptance({models:model.rows||[],contracts:market.rows||[],historyByPlayer,sport,date,sourceDiagnostics:diagnostics});
 return Response.json({ok:model.ok===true&&market.ok===true,...report,collectorCoverage:market.collectorCoverage||[],marketCoverage:market.coverage||[],modelStates:model.modelStates||[]},{headers:{'cache-control':'no-store'}});
}

/** Authenticated trigger builds models server-side; request bodies never supply forecasts. */
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return Response.json(unauthorizedBody(auth.reason),{status:403});
 const sport=new URL(request.url).searchParams.get('sport');
 if(!['nba','nfl','nhl','mlb'].includes(sport))return Response.json({ok:false,error:'Unsupported forecast capture sport'},{status:400});
 try{const result=await capturePropForecastJob(env,{sport});return Response.json(result,{status:result.ok?200:503,headers:{'cache-control':'no-store'}});}
 catch{return Response.json({ok:false,error:'FORECAST_CAPTURE_UNAVAILABLE'},{status:503});}
}
