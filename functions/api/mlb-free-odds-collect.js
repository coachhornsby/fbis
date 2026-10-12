import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { fetchParlayOdds } from "../lib/parlay.js";
import { classifyNhlQuoteEvidence as classifyQuote } from "../lib/nhlBookQuoteEvidence.js";

/** Authenticated MLB bookmaker capture. Observational only; no bet/EV decisions. */
const json=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"},
});
const chicagoDay=value=>{
 const t=Date.parse(value||"");
 return Number.isFinite(t)?new Intl.DateTimeFormat("en-CA",{
  timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"
 }).format(new Date(t)):null;
};
export async function onRequestPost(context){
 const auth=authorizeHarvest(context.request,context.env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!context.env.DB)return json({ok:false,error:"durable-evidence-db-unavailable"},503);
 if(!context.env.SHARPAPI_API_KEY&&!context.env.THERUNDOWN_API_KEY)
  return json({ok:false,error:"no-configured-free-mlb-provider"},503);
 const url=new URL(context.request.url);
 const date=url.searchParams.get("date");
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))
  return json({ok:false,error:"valid-date-required"},400);
 try{
  const result=await fetchParlayOdds("mlb",null,caches.default,{
   date,cacheOnly:true,strictCacheOnly:false,backupApiKey:null,
   sharpApiKey:context.env.SHARPAPI_API_KEY,
   theRundownApiKey:context.env.THERUNDOWN_API_KEY,
  });
  const capturedAt=new Date().toISOString();
  // The provider may list tomorrow's game even when asked about today's schedule.
  // Do not treat those events as evidence for the requested Chicago calendar date.
  const events=(result.events||[]).filter(e=>chicagoDay(e.commence)===date);
  let persistedMoneylineRows=0;
  const observations=[];
  for(const e of events){
   const book=String(e.moneylineBook||"");
   const paired=book && Number.isInteger(e.homeMl) && Number.isInteger(e.awayMl);
   const temporal=classifyQuote({gameStart:e.commence,sourceObservedAt:e.observedAt,capturedAt});
   observations.push({
    eventId:String(e.parlayId),home:e.homeTeam,away:e.awayTeam,
    start:e.commence||null,bookmaker:book||null,
    homeMl:e.homeMl??null,awayMl:e.awayMl??null,
    sourceObservedAt:temporal.sourceObservedAt,
    capturedAt,captureClass:temporal.captureClass,
    provider:result.meta?.provider||null,
   });
   if(!paired)continue;
   for(const [selection,price] of [["HOME",e.homeMl],["AWAY",e.awayMl]]){
    await context.env.DB.prepare(`INSERT INTO mlb_bookmaker_quote_evidence
      (id,source_event_id,game_start,home_team,away_team,market_family,selection,
       bookmaker,provider,american_price,source_observed_at,captured_at,capture_class,
       can_qualify,can_authorize_wager)
      VALUES (?1,?2,?3,?4,?5,'moneyline',?6,?7,?8,?9,?10,?11,?12,0,0)`)
      .bind(crypto.randomUUID(),String(e.parlayId),e.commence||null,
       String(e.homeTeam),String(e.awayTeam),selection,book,
       String(result.meta?.provider||"unknown"),price,
       temporal.sourceObservedAt,capturedAt,temporal.captureClass).run();
    persistedMoneylineRows++;
   }
  }
  const readback=await context.env.DB.prepare(
   "SELECT COUNT(*) AS n FROM mlb_bookmaker_quote_evidence WHERE captured_at=?1"
  ).bind(capturedAt).first();
  const readbackValidated=Number(readback?.n||0)===persistedMoneylineRows;
  if(!readbackValidated)throw new Error("mlb-evidence-readback-mismatch");
  const pairedMoneylines=persistedMoneylineRows/2;
  const payload={ok:pairedMoneylines>0,requestedDateCt:date,sport:"mlb",
   source:result.meta?.source||null,provider:result.meta?.provider||null,
   games:events.length,pairedMoneylines,persistedMoneylineRows,readbackValidated,
   capturedAt,observations,evidenceStore:"mlb_bookmaker_quote_evidence",
   authority:false,canQualify:false,canAuthorizeWager:false};
  return json(payload,pairedMoneylines?200:503);
 }catch(error){
  return json({ok:false,error:"mlb-free-collector-failed",detail:String(error?.message||error)},502);
 }
}
export async function onRequestGet(){return json({ok:false,error:"method-not-allowed"},405);}
