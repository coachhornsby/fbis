import { KALSHI_SHADOW_SERIES } from "../lib/kalshiMarketShadow.js";

const BASE = "kalshi/public-shadow/v1/";
const SPORTS = Object.freeze(["nfl","cfb"]);
async function readObject(r2,key){
  try {const object=await r2?.get?.(BASE+key);return object?await object.json():null;}catch{return null;}
}
export async function kalshiIntegrationHealth(env,{now=new Date()}={}){
 const collector=await readObject(env?.ARCHIVE,"collector-status.json");
 const upstreamBlocked=Boolean(collector?.blockedUntil&&Date.parse(collector.blockedUntil)>now.getTime());
 const sports=await Promise.all(SPORTS.map(async sport=>{
   const snap=await readObject(env?.ARCHIVE,"sports/"+sport+".json");
   const stamp=typeof snap?.capturedAt==="string"?Date.parse(snap.capturedAt):NaN;
   const age=Number.isFinite(stamp)?now.getTime()-stamp:null;
   const valid=!!snap?.ok && snap?.sport===sport && snap?.seriesTicker===KALSHI_SHADOW_SERIES[sport]
     && Array.isArray(snap?.records) && age!==null && age>=0 && age<=50*60*1000;
   return {sport,series:KALSHI_SHADOW_SERIES[sport],status:valid?"FRESH_SHADOW":
     age!==null&&age>50*60*1000?"STALE_SHADOW":"NO_VERIFIED_SNAPSHOT",
     capturedAt:typeof snap?.capturedAt==="string"?snap.capturedAt:null,
     ageSeconds:age!==null&&age>=0?Math.floor(age/1000):null,
     records:valid?snap.records.length:null,
     pageComplete:valid?snap.paginationComplete===true:null,
     // A fresh market page alone does not prove event/side matching.
     verifiedFixtureMatches:0,executionEligible:false,canQualify:false};
 }));
 return {
  ok:true,provider:"Kalshi",observedAt:now.toISOString(),
  collector:{
    state:collector?.status||"NOT_STARTED",
    lastAttemptAt:collector?.attemptedAt||null,
    lastSport:collector?.sport||null,lastCode:collector?.code||null,
    upstreamHttpStatus:collector?.httpStatus||null,
    blockedUntil:upstreamBlocked?collector.blockedUntil:null,
    schedule:"EVERY_15_MINUTES_ALTERNATING_NFL_CFB",
    storage:"CENTRAL_R2_NO_D1_WRITES",
    triggerVerified:!!collector?.attemptedAt,
  },sports,
  stages:{
    publicCollector:sports.some(x=>x.status==="FRESH_SHADOW")?"PARTIALLY_CAPTURING":"UNVERIFIED",
    eventIdentity:"UNQUALIFIED",contractRules:"UNQUALIFIED",
    feeAndLiquidity:"UNQUALIFIED",playerProps:"UNQUALIFIED",combos:"UNQUALIFIED",
    privateWebsocket:"NOT_VERIFIED_FROM_PUBLIC_DATA",
    wagerSettlement:"NOT_VERIFIED",
  },
  governance:{readOnly:true,canChangeCORE:false,canChangePinnOddsGap:false,
    canQualify:false,canAuthorizeWager:false,canSettleBets:false},
 };
}
export async function onRequestGet({env}){
 const result=await kalshiIntegrationHealth(env);
 return Response.json(result,{headers:{"cache-control":"public, max-age=30",
   "x-content-type-options":"nosniff","x-robots-tag":"noindex"}});
}
export async function onRequestPost(){
 return Response.json({ok:false,code:"READ_ONLY"},{status:405});
}
