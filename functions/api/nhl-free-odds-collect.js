import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { fetchParlayOdds } from "../lib/parlay.js";

/**
 * Scheduled NHL sportsbook observation only. Explicitly excludes paid
 * Parlay/TheOdds requests, model projection and wager decisions.
 */
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"},
});
export async function onRequestPost(context) {
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  const url=new URL(context.request.url);
  const date=url.searchParams.get("date")||null;
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"invalid-date"},400);
  if(!context.env.SHARPAPI_API_KEY&&!context.env.THERUNDOWN_API_KEY)
    return json({ok:false,error:"no-configured-free-nhl-provider"},503);
  try{
    const result=await fetchParlayOdds("nhl",null,caches.default,{
      cacheOnly:true,
      strictCacheOnly:false,
      backupApiKey:null,
      sharpApiKey:context.env.SHARPAPI_API_KEY,
      theRundownApiKey:context.env.THERUNDOWN_API_KEY,
      date,
    });
    const events=result.events||[];
    const observed=events.filter(e=>e.observedAt).length;
    const pairedMoneylines=events.filter(e=>e.homeMl!=null&&e.awayMl!=null).length;
    const payload={
      ok:events.length>0,
      sport:"nhl",
      source:result.meta?.source||null,
      provider:result.meta?.provider||null,
      games:events.length,
      pairedMoneylines,
      pricedWithOriginalTimestamp:observed,
      capturedAt:new Date().toISOString(),
      cacheOnly:Boolean(result.meta?.cached),
      observations:events.map(e=>({
        eventId:e.parlayId,home:e.homeTeam,away:e.awayTeam,
        moneylineBook:e.moneylineBook||null,spreadBook:e.spreadBook||null,totalBook:e.totalBook||null,
        homeMl:e.homeMl??null,awayMl:e.awayMl??null,
        spread:e.spread??null,total:e.total??null,
        observedAt:e.observedAt||null,
        attribution:e.observedAt?"SOURCE_TIMESTAMPED":"SOURCE_TIMESTAMP_MISSING",
      })),
      failClosed:true,
      canQualify:false,
      canAuthorizeWager:false,
    };
    return json(payload,events.length?200:503);
  }catch(error){
    return json({ok:false,error:"nhl-free-collector-failed",detail:String(error?.message||error)},502);
  }
}
export async function onRequestGet(){
 return json({ok:false,error:"method-not-allowed"},405);
}
