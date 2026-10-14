import {retiredOddsCollectorResponse} from "../lib/activeOddsPolicy.js";
import {authorizeHarvest} from "../lib/auth.js";
import {signedPolymarketUsHeaders,polymarketUsSubscribe,parsePolymarketUsLite} from "../lib/polymarketUsSignedWs.js";
import {persistNormalizedMarketBatch} from "../lib/marketObservationLedger.js";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const bounded=Number.isFinite;
async function latestPublicMarkets(db,{limit=8}={}){
  const q=await db.prepare(`WITH ranked AS (
   SELECT sport,canonical_event_id,provider_event_id,event_start_time,league,
    home_team,away_team,market_family,side,line,source_market_id,source_outcome_id,collected_at,
    ROW_NUMBER() OVER(PARTITION BY source_market_id ORDER BY collected_at DESC) rn
   FROM normalized_market_observations
   WHERE source='Polymarket US' AND source_market_id IS NOT NULL
    AND collected_at>=?1 AND event_start_time>=?2
  ) SELECT * FROM ranked WHERE rn=1 ORDER BY
   CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END, collected_at DESC, sport LIMIT ?3`)
  .bind(new Date(Date.now()-24*3600000).toISOString(),
    new Date(Date.now()-6*3600000).toISOString(),limit).all();
  return q.results||[];
}
/**
 * Bounded, authenticated WebSocket observation. Intentionally NOT a perpetual
 * stream; a short verified first step toward an always-on isolated connector.
 * No orders, no private portfolio, no trading, no auto-qualification.
 */
export async function onRequestPost({request,env}){
  if(!authorizeHarvest(request,env).ok)return json({ok:false,reason:"unauthorized"},403);
  return json(retiredOddsCollectorResponse("POLYMARKET_US_WS"),410);
  if(!env?.DB?.prepare)return json({ok:false,reason:"database-unavailable"},503);
  if(!env.POLYMARKET_US_KEY_ID||!env.POLYMARKET_US_SECRET_KEY)
    return json({ok:false,reason:"polymarket-credentials-not-configured"},503);
  const start=Date.now(),capturedAt=new Date().toISOString();
  let socket=null;
  try{
    const markets=await latestPublicMarkets(env.DB);
    if(!markets.length)return json({ok:false,reason:"no-sampled-markets",connected:false},424);
    const path="/v1/ws/markets";
    const headers=await signedPolymarketUsHeaders({
      keyId:env.POLYMARKET_US_KEY_ID,secretKey:env.POLYMARKET_US_SECRET_KEY,path
    });
    // CF Workers outbound WebSocket upgrade through fetch supports custom headers.
    const up=await fetch("https://api.polymarket.us"+path,{
      headers:{...headers,Upgrade:"websocket"},signal:AbortSignal.timeout(14000)
    });
    if(up.status!==101||!up.webSocket)return json({
      ok:false,reason:"market-ws-handshake-failed",httpStatus:up.status,
      credentialsPresent:true,connected:false,subscribed:false
    },502);
    socket=up.webSocket;
    socket.accept();
    const symbols=[...new Set(markets.map(m=>m.source_market_id))].slice(0,8);
    const symbolMap=new Map(markets.map(m=>[m.source_market_id,m]));
    const ticks=[];
    let received=0,parsed=0,errors=0;
    const handle=event=>{
      received++;
      let value=null;
      try{value=JSON.parse(String(event.data||""))}catch{errors++;return}
      if(value?.error){errors++;return}
      const tick=parsePolymarketUsLite(value);
      if(!tick)return;
      parsed++;
      if(symbolMap.has(tick.marketSlug)&&ticks.length<100)ticks.push({...tick,capturedAt:new Date().toISOString()});
    };
    socket.addEventListener("message",handle);
    socket.send(JSON.stringify(polymarketUsSubscribe(symbols,"fbis-public-market-lite")));
    await new Promise(resolve=>setTimeout(resolve,6000));
    socket.removeEventListener("message",handle);
    try{socket.close(1000,"capture complete")}catch{}
    socket=null;
    // Deduplicated latest BBO by contract; full event-by-event history is
    // reserved for the persistent subscriber phase.
    const recent=[...new Map(ticks.map(t=>[t.marketSlug,t])).values()];
    const valid=recent.filter(t=>t.bestAsk!=null||t.bestBid!=null);
    const offers=valid.map(t=>{
      const base=symbolMap.get(t.marketSlug);
      return {source:"Polymarket US WebSocket",sourceType:"exchange",sport:base.sport,
        league:base.league,eventId:base.canonical_event_id,eventStart:base.event_start_time,
        homeTeam:base.home_team,awayTeam:base.away_team,marketFamily:base.market_family,
        side:base.side,line:base.line,contractPrice:t.bestAsk,
        standardOrAlt:"unknown",period:"full_game",sourceMarketId:t.marketSlug,
        sourceOutcomeId:base.source_outcome_id,fetchedAt:t.capturedAt,
        executionEligible:false,canQualify:false,canAuthorizeWager:false,
        raw:{providerEventId:base.provider_event_id,
          providerMarketId:t.marketSlug,providerOutcomeId:base.source_outcome_id,
          quoteKind:"WS_BBO_BEST_ASK_NO_VERIFIED_FILL",bestBid:t.bestBid,bestAsk:t.bestAsk,
          lastTrade:t.lastTrade,bidDepth:t.bidDepth,askDepth:t.askDepth,
          connectionStartedAt:capturedAt,sourceObservedAt:null,quoteObservedAt:null,
          marketObservedAt:null,canQualify:false,canAuthorizeWager:false,
          marketAccess:"READ_ONLY",accountDataCollected:false}};
    });
    let inserted=0;
    if(offers.length){
      const saved=await persistNormalizedMarketBatch(env.DB,offers,{
        snapshotType:"CURRENT",collectedAt:new Date().toISOString(),modelProbability:null
      });
      inserted=saved.inserted;
    }
    return json({
      ok:true,source:"Polymarket US authenticated Market WebSocket",connected:true,
      subscribed:true,readOnly:true,tradingEnabled:false,accountDataCollected:false,
      canQualify:false,canAuthorizeWager:false,
      sampledMarketCount:symbols.length,marketMessages:received,parsedMarketMessages:parsed,
      subscriptionErrors:errors,validBbo:valid.length,inserted,
      firstMarketQuoteAvailable:valid.length>0,
      elapsedMs:Date.now()-start,capturedAt
    });
  }catch(error){
    try{socket?.close(1011,"capture stopped")}catch{}
    // Never return errors that might contain headers or secret-containing URLs.
    const code=String(error?.message||"");
    const safeReason=/polymarket-secret-not-configured|polymarket-key-id-not-configured|no-valid-market-symbols/.test(code)?"credentials-invalid":
      /timed out|timeout|TimeoutError/i.test(code)?"handshake-timeout":"signed-websocket-probe-error";
    return json({ok:false,reason:safeReason,connected:false,canAuthorizeWager:false},502);
  }
}
export async function onRequestGet(){return json({ok:false,reason:"method-not-allowed"},405)}
