import {KALSHI_SHADOW_SERIES,kalshiShadowAuthority} from "./kalshiMarketShadow.js";

const PREFIX="kalshi/public-shadow/v1/";
const VALID=new Set(["nfl","cfb","atp","wta","atp_challenger","itf_men","itf_women",
 "atp_doubles","wta_doubles","itf_doubles","itf_women_doubles"]); // Scheduled single-writer sports only.
async function readJson(bucket,key){
  if(!bucket?.get)return null;
  try{const x=await bucket.get(PREFIX+key);return x?await x.json():null;}catch{return null;}
}
export async function loadKalshiR2Shadow(env,sport,{now=new Date(),maxAgeMs=50*60*1000}={}){
  if(!VALID.has(sport))return {ok:false,code:"KALSHI_COLLECTOR_SPORT_NOT_ENABLED",
    collector:"SCHEDULED_WORKER_R2",governance:kalshiShadowAuthority()};
  if(!env?.ARCHIVE?.get)return {ok:false,code:"KALSHI_R2_BINDING_MISSING",
    governance:kalshiShadowAuthority()};
  const [status,snapshot]=await Promise.all([
    readJson(env.ARCHIVE,"collector-status.json"),
    readJson(env.ARCHIVE,"sports/"+sport+".json"),
  ]);
  const capturedAt=snapshot?.capturedAt;
  const captured=Date.parse(capturedAt||"");
  const age=Number.isFinite(captured)?now.getTime()-captured:null;
  if(!snapshot?.ok||!Array.isArray(snapshot?.records)||snapshot?.sport!==sport
    ||snapshot?.seriesTicker!==KALSHI_SHADOW_SERIES[sport]
    ||age===null||age<0||age>maxAgeMs){
    return {ok:false,code:age!==null&&age>maxAgeMs?"KALSHI_SNAPSHOT_STALE":
      status?.code==="KALSHI_PUBLIC_RATE_LIMITED"?"KALSHI_PUBLIC_RATE_LIMITED":"KALSHI_SNAPSHOT_NOT_READY",
      rateLimited:status?.status==="RATE_LIMITED",
      collector:"SCHEDULED_WORKER_R2",capturedAt:capturedAt||null,
      lastAttemptAt:status?.attemptedAt||null,blockedUntil:status?.blockedUntil||null,
      governance:kalshiShadowAuthority()};
  }
  // No R2 payload may elevate authority even if it is forged or accidentally
  // encoded by a later collector revision.
  const rows=snapshot.records.filter(r=>{
    if(r?.sport!==sport||typeof r.ticker!=="string"
      ||!r.ticker.startsWith(KALSHI_SHADOW_SERIES[sport]+"-"))return false;
    // A late final page cannot make earlier paginated market quotes fresh.
    const fetched=Date.parse(r.fetchedAt||snapshot.capturedAt||"");
    const age=now.getTime()-fetched;
    return Number.isFinite(fetched)&&age>=0&&age<=maxAgeMs;
  }).slice(0,4000).map(r=>({...r,...kalshiShadowAuthority(),
    matchStatus:"UNMATCHED",canonicalEventId:null,
    feesDollars:null,netCostDollars:null,impliedEdge:null}));
  if(!rows.length&&snapshot.records.length)
    return {ok:false,code:"KALSHI_SNAPSHOT_STALE",
      collector:"SCHEDULED_WORKER_R2",capturedAt,
      governance:kalshiShadowAuthority()};
  const completeFresh=rows.length===snapshot.records.length
    &&snapshot.paginationComplete===true;
  return {
    ok:true,provider:"Kalshi",sport,seriesTicker:KALSHI_SHADOW_SERIES[sport],
    capturedAt,snapshotAgeSeconds:Math.floor(age/1000),records:rows,
    paginationComplete:completeFresh,
    rowsDiscardedForStaleness:snapshot.records.length-rows.length,
    sourceQueryComplete:snapshot.paginationComplete===true,
    collector:"SCHEDULED_WORKER_R2",cacheScope:"CENTRAL_R2_READ_ONLY",
    marketTypeScope:"GAMES_ONLY",governance:kalshiShadowAuthority(),
  };
}
