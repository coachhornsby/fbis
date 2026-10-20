import { getKalshiShadowMarkets, getKalshiShadowBook, KALSHI_SHADOW_SERIES } from "../lib/kalshiMarketShadow.js";

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
export async function onRequestGet({request,fetchImpl=fetch}) {
  const url=new URL(request.url);
  const sport=(url.searchParams.get("sport")||"").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(KALSHI_SHADOW_SERIES,sport)) {
    return json({ok:false,code:"KALSHI_SERIES_NOT_QUALIFIED"},400);
  }
  const ticker=url.searchParams.get("ticker");
  const data=ticker
    ? await getKalshiShadowBook(sport,ticker,{fetchImpl})
    : await getKalshiShadowMarkets(sport,{fetchImpl,limit:url.searchParams.get("limit")||80});
  return json(data,data.ok?200:data.code==="KALSHI_TICKER_NOT_ALLOWED"?400:503);
}
export async function onRequestPost(){return json({ok:false,code:"READ_ONLY"},405)}
