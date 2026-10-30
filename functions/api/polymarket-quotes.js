import {loadBoundedPolymarketSnapshot,selectBoundedPolymarketOffers} from '../lib/boundedPolymarketBoard.js';
import {ROSTER_SPORTS as FBIS_POLY_SPORTS} from '../lib/boundedPolymarketRoster.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public, max-age=3, stale-while-revalidate=2'}});
/** Quotes already collected server-side. Browser refreshes never contact the provider or change forecasts. */
export async function onRequestGet({request,env}){
 const u=new URL(request.url),sport=u.searchParams.get('sport'),marketFamily=u.searchParams.get('marketFamily')||'moneyline',ids=[...new Set((u.searchParams.get('eventIds')||'').split(',').filter(Boolean))];
 if(!['moneyline','spread','total','all'].includes(marketFamily)||!FBIS_POLY_SPORTS.includes(sport)||!ids.length||ids.length>40||ids.some(id=>!/^[-a-z0-9_:/.]{1,160}$/i.test(id)))return json({ok:false,error:'INVALID_EVENT_SCOPE'},400);
 try{
  const snapshot=await loadBoundedPolymarketSnapshot(env);
  if(!snapshot.ok)return json({ok:false,error:snapshot.code,canQualify:false,canAuthorizeWager:false},503);
  // The scoped endpoint uses the stored fixture start; the TODAY board also
  // checks it against the independent fixture supplied by the slate engine.
  const games=snapshot.ok?snapshot.roster.filter(r=>r.sport===sport&&ids.includes(r.canonical_event_id)).map(r=>({id:r.canonical_event_id,sport,start:r.event_start_time})):[];
  const loaded=selectBoundedPolymarketOffers(snapshot,games,sport);
  return json({ok:true,checkedAt:new Date().toISOString(),scope:marketFamily==='all'?'FULL_GAME_MARKET_QUOTES':`${marketFamily.toUpperCase()}_CARD_QUOTES`,byEvent:Object.fromEntries([...loaded.byId].map(([id,offers])=>[id,offers.filter(o=>String(o.source||'').startsWith('Polymarket US')&&(marketFamily==='all'||o.marketFamily===marketFamily))])),diagnostics:{...(loaded.diagnostics||{}),historyBindings:[]},canQualify:false,canAuthorizeWager:false});
 }
 catch{return json({ok:false,error:'QUOTE_STORE_UNAVAILABLE',canAuthorizeWager:false},503);}
}
