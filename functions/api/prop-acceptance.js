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
 const report=buildPropAcceptance({models:model.rows||[],contracts:market.rows||[],sport,date,sourceDiagnostics:diagnostics});
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
