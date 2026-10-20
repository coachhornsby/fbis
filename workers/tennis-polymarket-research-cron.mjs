/** Scheduled, authorized Polymarket.com ATP/WTA research refresh.
 * Uses an existing Cloudflare cron and secret, not a second secret copy.
 * Nothing in this source authorizes betting, market-history writes or
 * exchange-probability-driven FBIS projections.
 */
export const POLYMARKET_TENNIS_RESEARCH_LATEST =
 "tennis/polymarket-global/research-snapshot-v1.json";
const COLLECT_URL="https://fbis-myz.pages.dev/api/polymarket-global-tennis-collect";
export const MAX_SKIP_AGE_MS=8*60*1000;
export async function runTennisPolymarketResearchCron(env,{
 now=Date.now(),request=fetch,
}={}){
 const started=new Date(now).toISOString();
 if(!env?.HARVEST_SECRET||!env?.R2_ARCHIVE?.get)
  throw new Error("TENNIS_GAMMA_CRON_SECRET_OR_ARCHIVE_MISSING");
 let ageMs=null;
 try{
  const previous=await env.R2_ARCHIVE.get(POLYMARKET_TENNIS_RESEARCH_LATEST);
  if(previous){
   const body=await previous.json();
   const captured=Date.parse(body?.asOf||"");
   if(body?.source==="POLYMARKET_GLOBAL_GAMMA"&&Number.isFinite(captured)){
    ageMs=now-captured;
    if(ageMs>=0&&ageMs<MAX_SKIP_AGE_MS&&Array.isArray(body.events))
     return {ok:true,status:"SKIPPED_FRESH",ageMinutes:Math.round(ageMs/60000),checkedAt:started,
      canAuthorizeWager:false};
   }
  }
 }catch{
  // An R2 read error cannot falsely report a fresh snapshot.
  ageMs=null;
 }
 const response=await request(COLLECT_URL,{
  method:"POST",
  headers:{"x-harvest-secret":env.HARVEST_SECRET,"content-type":"application/json",
   "accept":"application/json"},
  body:"{}",
  signal:AbortSignal.timeout(175000),
 });
 if(!response?.ok)throw new Error("TENNIS_GAMMA_CRON_HTTP_"+(response?.status||"UNKNOWN"));
 const receipt=await response.json();
 const captured=Date.parse(receipt?.asOf||"");
 if(receipt?.ok!==true||receipt?.source!=="POLYMARKET_GLOBAL_GAMMA"||
  receipt.canAuthorizeWager!==false||!Number.isFinite(captured)||
  captured<now-5*60000||captured>now+60000)
  throw new Error("TENNIS_GAMMA_CRON_RECEIPT_INVALID");
 return {ok:true,status:"REFRESHED",checkedAt:started,asOf:receipt.asOf,
  fixtures:Number(receipt.fixtureCount)||0,matchedEvents:Number(receipt.matchedEvents)||0,
  warnings:Array.isArray(receipt.errors)?receipt.errors.length:0,
  canAuthorizeWager:false};
}
