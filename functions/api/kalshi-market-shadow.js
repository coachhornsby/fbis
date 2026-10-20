import { KALSHI_SHADOW_SERIES } from "../lib/kalshiMarketShadow.js";
import { cachedKalshiShadow } from "../lib/kalshiMarketCollector.js";
import { loadKalshiR2Shadow } from "../lib/kalshiR2Shadow.js";

const json=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"public, max-age=15, stale-while-revalidate=15",
    "x-content-type-options":"nosniff",
    "x-robots-tag":"noindex",
  },
});
/**
 * Public read-only research surface. Never touches env.DB, private API keys,
 * FBIS game cards, tracked bets or a settlement/qualification pipeline.
 * The query cannot enable production authority, trading or persistence.
 */
export async function onRequestGet({request,fetchImpl=fetch,context=null,env=null}) {
  const url=new URL(request.url);
  const sport=(url.searchParams.get("sport")||"").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(KALSHI_SHADOW_SERIES,sport)) {
    return json({ok:false,code:"KALSHI_SERIES_NOT_QUALIFIED"},400);
  }
  const ticker=url.searchParams.get("ticker");
  // Production with R2 always reads the single scheduled collector's public
  // snapshot. Never fan out API requests through Board visitors, including
  // ticker inspection. Explicitly mark uncollected detail unavailable.
  const productionEnv=env||context?.env;
  const data=productionEnv?.ARCHIVE?.get
    ? ticker
      ? {ok:false,code:"KALSHI_ORDERBOOK_NOT_COLLECTED",collector:"SCHEDULED_WORKER_R2"}
      : await loadKalshiR2Shadow(productionEnv,sport)
    : await cachedKalshiShadow({
      sport,ticker,fetchImpl,
      cache:context?.cache ?? (typeof caches!=="undefined" ? caches.default : null),
      waitUntil:context?.waitUntil,
    });
  const response=json(data,data.ok?200:data.code==="KALSHI_TICKER_NOT_ALLOWED"?400:data.rateLimited?429:503);
  if(data.rateLimited && Number.isFinite(data.retryAfterSeconds)){
    response.headers.set("retry-after",String(Math.ceil(data.retryAfterSeconds)));
  }
  if(!data.ok)response.headers.set("cache-control","no-store");
  else if(data.collector==="SCHEDULED_WORKER_R2")response.headers.set("cache-control","public, max-age=20");
  return response;
}
export async function onRequestPost(){return json({ok:false,code:"READ_ONLY"},405)}
