import { FBIS_POLY_SPORTS } from "../lib/polymarketUs.js";
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
/** Public research coverage status. No account data or trading credentials. */
export async function onRequestGet({env}){
 if(!env.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
 try{
  const now=new Date(),cutoff=new Date(now.getTime()-24*3600000).toISOString();
  const r=await env.DB.prepare(`SELECT sport,COUNT(*) observations,MAX(collected_at) last_capture,
    COUNT(DISTINCT provider_event_id) provider_events,
    COUNT(DISTINCT canonical_event_id) matched_games,
    SUM(CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END) unmatched_observations,
    SUM(CASE WHEN contract_price IS NOT NULL THEN 1 ELSE 0 END) displayed_prices
    FROM normalized_market_observations WHERE source='Polymarket US' AND collected_at>=?1
    GROUP BY sport`).bind(cutoff).all();
  const ws=await env.DB.prepare(`SELECT COUNT(*) n,MAX(collected_at) last_capture,
      COUNT(DISTINCT canonical_event_id) matched_games,
      COUNT(DISTINCT source_market_id) contracts
      FROM normalized_market_observations
      WHERE source='Polymarket US WebSocket' AND collected_at>=?1`).bind(cutoff).first();
  let stream=null;
  try{const response=await fetch("https://fbis-polymarket-us-stream.coachhornsby.workers.dev/health",{signal:AbortSignal.timeout(4000)});
   if(response.ok){const value=await response.json();if(value.ok===true)stream=value;}
  }catch{}
  const by=new Map((r.results||[]).map(x=>[x.sport,x]));
  const states=FBIS_POLY_SPORTS.map(s=>{
   const item=by.get(s);return {sport:s,
    status:item?.observations>0?"RECENT_OBSERVATIONS":"NO_RECENT_MARKET_CAPTURE",
    observationCount:Number(item?.observations||0),
    providerEvents:Number(item?.provider_events||0),
    matchedGames:Number(item?.matched_games||0),
    unmatchedObservations:Number(item?.unmatched_observations||0),
    displayedPrices:Number(item?.displayed_prices||0),
    lastCapture:item?.last_capture||null}
  });
  return json({ok:true,source:"Polymarket US public gateway",
    region:"US",windowHours:24,readOnly:true,canQualify:false,canAuthorizeWager:false,
    fullMarketCoverageVerified:false,
    signedMarketWebsocket:{
      credentialsConfigured:Boolean(env.POLYMARKET_US_KEY_ID&&env.POLYMARKET_US_SECRET_KEY),
      readOnly:true,
      lastBboCapture:ws?.last_capture||null,
      bboRecordsLast24h:Number(ws?.n||0),
      matchedEventsLast24h:Number(ws?.matched_games||0),
      contractCountLast24h:Number(ws?.contracts||0),
      operational:stream?.operational===true,
      connectionStatus:stream?stream.connected?"CONNECTED":"DISCONNECTED":"HEALTH_UNAVAILABLE",
      lastMessageAt:stream?.lastMessageAt||null,
      lastHeartbeatAt:stream?.lastHeartbeatAt||null,
      lastError:stream?.lastError||null,
      lastClose:stream?.lastClose||null
    },sports:states});
 }catch(error){return json({ok:false,error:"market-status-unavailable",detail:String(error?.message||error)},502)}
}
export async function onRequestPost(){return json({ok:false,error:"method-not-allowed"},405)}
