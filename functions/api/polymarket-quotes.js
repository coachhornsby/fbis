import {loadPolymarketUsBoardOffers} from '../lib/polymarketBoard.js';
import {FBIS_POLY_SPORTS} from '../lib/polymarketUs.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public, max-age=3, stale-while-revalidate=2'}});
/** Quotes already collected server-side. Browser refreshes never contact the provider or change forecasts. */
export async function onRequestGet({request,env}){
 const u=new URL(request.url),sport=u.searchParams.get('sport'),ids=[...new Set((u.searchParams.get('eventIds')||'').split(',').filter(Boolean))];
 if(!FBIS_POLY_SPORTS.includes(sport)||!ids.length||ids.length>40||ids.some(id=>!/^[-a-z0-9_:/.]{1,160}$/i.test(id)))return json({ok:false,error:'INVALID_EVENT_SCOPE'},400);
 try{const loaded=await loadPolymarketUsBoardOffers(env.DB,ids.map(id=>({id})),sport,{historyDb:env.MARKET_HISTORY_DB});
 return json({ok:true,checkedAt:new Date().toISOString(),byEvent:Object.fromEntries(loaded.byId),diagnostics:loaded.diagnostics,canQualify:false,canAuthorizeWager:false});}
 catch{return json({ok:false,error:'QUOTE_STORE_UNAVAILABLE',canAuthorizeWager:false},503);}
}
