import { buildSlate,resolveSlateDate } from '../lib/slateEngine.js';
import { independentPropRows,loadPropFixturesAndPlayers,resolvePropModelIdentities } from '../lib/propResearchData.js';
import { chicagoDayBounds } from '../lib/chicagoDayBounds.js';
import { buildPropAcceptance,assessPropModel } from '../lib/propAcceptance.js';
import { PROP_SPORTS } from '../lib/exchangePlayerProps.js';
export async function onRequestGet({env,request}) {
 const u=new URL(request.url),sport=u.searchParams.get('sport')||'nfl',date=resolveSlateDate(u.searchParams.get('date')||'',{maxPast:0,maxFuture:7});
 if(!PROP_SPORTS.includes(sport)||!date.ok)return Response.json({ok:false,error:'Invalid sport or date'}, {status:400});
 try {
  const slate=await buildSlate(sport,date.date,{...env,caches:typeof caches==='undefined'?null:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false});
  const context=await loadPropFixturesAndPlayers(env,{...chicagoDayBounds(date.date),sport});
  const rows=resolvePropModelIdentities(independentPropRows(slate),context).map(r=>({...r,dataAcceptance:assessPropModel(r)}));
  return Response.json({ok:true,sport,date:date.date,rows,acceptance:buildPropAcceptance({models:rows,sport,date:date.date,sourceDiagnostics:context.diagnostics}),modelStates:(slate.games||[]).map(g=>({eventId:g.id,...g.playerProjectionStatus})),canQualify:false,canAuthorizeWager:false}, {headers:{'cache-control':'public,max-age=120'}});
 }catch{return Response.json({ok:false,rows:[],error:'MODEL_DELIVERY_UNAVAILABLE'},{status:503});}
}
