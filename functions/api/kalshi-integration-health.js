import { KALSHI_SHADOW_SERIES } from "../lib/kalshiMarketShadow.js";

const BASE = "kalshi/public-shadow/v1/";
const SPORTS = Object.freeze(["nfl","cfb"]);
async function readObject(r2,key){
  try {const object=await r2?.get?.(BASE+key);return object?await object.json():null;}catch{return null;}
}
export async function kalshiIntegrationHealth(env,{now=new Date()}={}){
 const collector=await readObject(env?.ARCHIVE,"collector-status.json");
 const catalogStatus=await readObject(env?.ARCHIVE,"series-catalog-status.json");
 const catalog=await readObject(env?.ARCHIVE,"series-catalog.json");
 const exchangeReceipt=await readObject(env?.ARCHIVE,"exchange-status.json");
 const observedAt=Date.parse(exchangeReceipt?.observedAt||"");
 const exchangeAge=Number.isFinite(observedAt)?now.getTime()-observedAt:null;
 const exchangeFresh=exchangeAge!==null&&exchangeAge>=0&&exchangeAge<=75*60*1000
   &&exchangeReceipt?.state==="VERIFIED"
   &&typeof exchangeReceipt?.exchange?.exchangeActive==="boolean"
   &&typeof exchangeReceipt?.exchange?.tradingActive==="boolean";
 const exchangeStatus={
   state:!exchangeReceipt?"NOT_OBSERVED":exchangeFresh?"RECENT_PROVIDER_REPORT":
     exchangeReceipt.state==="VERIFIED"?"STALE_PROVIDER_REPORT":
     exchangeReceipt.state==="RATE_LIMITED"?"RATE_LIMITED":"UNAVAILABLE",
   lastObservedAt:typeof exchangeReceipt?.observedAt==="string"?exchangeReceipt.observedAt:null,
   ageSeconds:exchangeAge!==null&&exchangeAge>=0?Math.floor(exchangeAge/1000):null,
   nextAllowedAt:typeof exchangeReceipt?.nextAllowedAt==="string"?exchangeReceipt.nextAllowedAt:null,
   upstreamHttpStatus:Number.isInteger(exchangeReceipt?.httpStatus)?exchangeReceipt.httpStatus:null,
   exchangeActive:exchangeFresh?exchangeReceipt.exchange.exchangeActive:null,
   tradingActive:exchangeFresh?exchangeReceipt.exchange.tradingActive:null,
   transfersActive:exchangeFresh&&typeof exchangeReceipt.exchange.transfersActive==="boolean"
     ?exchangeReceipt.exchange.transfersActive:null,
   estimatedResumeAt:exchangeFresh?exchangeReceipt.exchange.estimatedResumeAt||null:null,
   exchangeIndexCount:exchangeFresh&&Array.isArray(exchangeReceipt.exchange.exchangeIndices)
     ?exchangeReceipt.exchange.exchangeIndices.length:null,
   statusScope:"LAST_PUBLIC_PROVIDER_REPORT_NOT_EXECUTION_AUTHORIZATION",
   canQualify:false,canAuthorizeWager:false,
 };
 const upstreamBlocked=Boolean(collector?.blockedUntil&&Date.parse(collector.blockedUntil)>now.getTime());
 const sports=await Promise.all(SPORTS.map(async sport=>{
   const [snap,attempt,progress]=await Promise.all([
     readObject(env?.ARCHIVE,"sports/"+sport+".json"),
     readObject(env?.ARCHIVE,"sports/"+sport+"-status.json"),
     readObject(env?.ARCHIVE,"sports/"+sport+"-progress.json"),
   ]);
   const stamp=typeof snap?.capturedAt==="string"?Date.parse(snap.capturedAt):NaN;
   const age=Number.isFinite(stamp)?now.getTime()-stamp:null;
   const valid=!!snap?.ok && snap?.sport===sport && snap?.seriesTicker===KALSHI_SHADOW_SERIES[sport]
     && Array.isArray(snap?.records) && age!==null && age>=0 && age<=50*60*1000;
   const rows=valid?snap.records:null;
   const maxRowAge=Array.isArray(rows)?rows.reduce((max,r)=>{
     const source=Date.parse(r?.fetchedAt||snap.capturedAt||"");
     if(!Number.isFinite(source))return Number.POSITIVE_INFINITY;
     return Math.max(max,now.getTime()-source);
   },0):null;
   const allRowsRecent=valid&&maxRowAge>=0&&maxRowAge<=50*60*1000;
   const paginationComplete=valid&&snap.paginationComplete===true&&allRowsRecent;
   return {
     sport,series:KALSHI_SHADOW_SERIES[sport],
     status:valid?(allRowsRecent?"FRESH_SHADOW":"PARTIALLY_STALE_SHADOW"):
       age!==null&&age>50*60*1000?"STALE_SHADOW":"NO_VERIFIED_SNAPSHOT",
     capturedAt:typeof snap?.capturedAt==="string"?snap.capturedAt:null,
     ageSeconds:age!==null&&age>=0?Math.floor(age/1000):null,
     records:valid?snap.records.length:null,
     pageComplete:paginationComplete,
     inventoryPages:snap?.pagesFetched??null,
     attemptedAt:attempt?.attemptedAt||null,
     lastAttemptState:attempt?.status||"NOT_OBSERVED",
     lastAttemptCode:attempt?.code||null,
     pagesFetchedInProgress:progress?.cursor?progress.pagesFetched||0:0,
     recordsInProgress:progress?.cursor?progress.records?.length||0:0,
     continuationPending:typeof progress?.cursor==="string"&&progress.cursor.length>0,
     allRecordsFresh:valid?allRowsRecent:false,
     oldestRecordAgeSeconds:valid&&maxRowAge>=0?Math.round(maxRowAge/1000):null,
     // A verified provider list alone never grants executable price authority.
     verifiedFixtureMatches:0,executionEligible:false,canQualify:false,
   };
 }));
 return {
  ok:true,provider:"Kalshi",observedAt:now.toISOString(),
  collector:{
    state:collector?.status||"NOT_STARTED",
    authenticationMode:collector?.authenticationMode||"UNVERIFIED",
    lastAttemptAt:collector?.attemptedAt||null,
    lastSport:collector?.sport||null,lastCode:collector?.code||null,
    upstreamHttpStatus:collector?.httpStatus||null,
    blockedUntil:upstreamBlocked?collector.blockedUntil:null,
    schedule:"EVERY_15_MINUTES_ALTERNATING_NFL_CFB",
    storage:"CENTRAL_R2_NO_D1_WRITES",
    triggerVerified:!!collector?.attemptedAt,
  },sports,exchangeStatus,
  seriesCatalog:{
    state:catalogStatus?.status||"NOT_STARTED",
    observedAt:catalogStatus?.observedAt||null,
    nextAllowedAt:catalogStatus?.nextAllowedAt||null,
    providerSeriesCount:Number.isInteger(catalog?.reportedSeries)?catalog.reportedSeries:null,
    storedSeriesCount:Number.isInteger(catalog?.storedSeries)?catalog.storedSeries:null,
    catalogTruncated:catalog?.truncated===true,
    categoryFilter:"Sports",
    scope:"DISCOVERY_NOT_VALIDATED_CONTRACT_COVERAGE",
    canQualify:false,
  },
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
