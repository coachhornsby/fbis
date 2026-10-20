/**
 * Dedicated schedule-only Kalshi PUBLIC market relay.
 *
 * The signed GET executes in Pages where the existing proven Kalshi Ed25519
 * private-key binding is present; this Worker NEVER signs requests or calls
 * Kalshi anonymously. It passes only a separate encrypted service token.
 */
const PREFIX="kalshi/public-shadow/v1/";
const SPORTS=["nfl","cfb"];
const TENNIS_RESEARCH=["atp","wta"];
const SLOT_MS=15*60*1000;
const PAGES_ROUTE="https://fbis-myz.pages.dev/api/kalshi-collector-internal";
const ms=v=>Number.isFinite(Date.parse(v||""))?Date.parse(v):0;
async function readJson(bucket,key){
  if(!bucket?.get)return null;
  try{const x=await bucket.get(PREFIX+key);return x?await x.json():null;}catch{return null;}
}
async function writeJson(bucket,key,value){
  if(!bucket?.put)return;
  await bucket.put(PREFIX+key,JSON.stringify(value),{
    httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"},
  });
}
export function selectedSport(now){
  return SPORTS[Math.floor(now.getTime()/SLOT_MS)%SPORTS.length];
}
export async function relaySignedPages(env,{scope,sport=null,fetchImpl=fetch}={}){
  // This binding is generated independently, shared only between the Worker
  // and Pages, and must never be substituted with a user's portfolio code.
  if(typeof env?.FBIS_KALSHI_RELAY_TOKEN!=="string"
    ||env.FBIS_KALSHI_RELAY_TOKEN.length<40)
    return {ok:false,code:"SIGNED_RELAY_SECRET_MISSING"};
  if(scope!=="markets"&&scope!=="exchange-status"&&scope!=="series-catalog"&&scope!=="qualification-evidence"&&scope!=="player-props"&&scope!=="multilegs"&&scope!=="combo-tape"&&scope!=="nhl-official-prop-results"&&scope!=="prop-reconciliation")
    return {ok:false,code:"SIGNED_RELAY_SCOPE_NOT_ALLOWED"};
  if(scope==="markets"&&![...SPORTS,...TENNIS_RESEARCH].includes(sport))
    return {ok:false,code:"KALSHI_SPORT_NOT_ENABLED"};
  const url=new URL(PAGES_ROUTE);
  url.searchParams.set("scope",scope);
  if(sport)url.searchParams.set("sport",sport);
  let response;
  try{
    response=await fetchImpl(url.toString(),{
      method:"POST",redirect:"manual",
      headers:{"x-fbis-kalshi-relay-token":env.FBIS_KALSHI_RELAY_TOKEN,
        "accept":"application/json"},
      signal:AbortSignal.timeout(25000),
    });
  }catch{return {ok:false,code:"PAGES_RELAY_UNAVAILABLE"};}
  if(!response.ok) {
    // Do not reflect status bodies or any service tokens.
    return {ok:false,code:response.status===403?"PAGES_RELAY_DENIED":
      response.status===429?"KALSHI_SIGNED_RATE_LIMITED":"PAGES_RELAY_HTTP_ERROR",
      httpStatus:response.status};
  }
  try{
    const d=await response.json();
    if(d?.ok!==true)return {ok:false,code:"PAGES_RELAY_INVALID_RECEIPT"};
    return {ok:true,status:d.status||d.state||"CAPTURED",
      sport:d.sport||sport||null,records:Number.isInteger(d.records)?d.records:null};
  }catch{return {ok:false,code:"PAGES_RELAY_INVALID_RECEIPT"};}
}
export async function collectKalshiPublicOnce(env,{now=new Date(),fetchImpl=fetch}={}){
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  const sport=selectedSport(now);
  const last=await readJson(env.ARCHIVE,"collector-status.json");
  if(last?.authenticationMode==="SIGNED_PAGES"
    &&ms(last.blockedUntil)>now.getTime())
    return {ok:false,code:"KALSHI_SIGNED_COOLDOWN",blockedUntil:last.blockedUntil};
  const result=await relaySignedPages(env,{scope:"markets",sport,fetchImpl});
  const configurationFailure=result.code==="SIGNED_RELAY_SECRET_MISSING"
    ||result.code==="PAGES_RELAY_DENIED";
  const relayTransportFailure=result.code==="PAGES_RELAY_UNAVAILABLE"
    ||result.code==="PAGES_RELAY_HTTP_ERROR"
    ||result.code==="PAGES_RELAY_INVALID_RECEIPT";
  if(configurationFailure||relayTransportFailure){
    // Previously only missing credentials were recorded; timeouts left an
    // older CAPTURED receipt misleadingly presented as current. Keep the
    // earlier sport snapshot intact but surface this attempt's real outcome.
    const receipt={
      source:"Kalshi",collector:"SCHEDULED_WORKER_R2",
      authenticationMode:configurationFailure?"SIGNED_RELAY_UNCONFIGURED":"SIGNED_PAGES",
      attemptedAt:now.toISOString(),sport,
      status:configurationFailure?"CONFIGURATION_REQUIRED":"RELAY_ERROR",
      code:result.code,httpStatus:result.httpStatus||null,blockedUntil:null,
      canQualify:false,canAuthorizeWager:false,canWriteMarketHistory:false,
    };
    await writeJson(env.ARCHIVE,"sports/"+sport+"-status.json",receipt);
    await writeJson(env.ARCHIVE,"collector-status.json",receipt);
  }
  // Pages remains the sole writer of CAPTURED/provider RATE_LIMITED
  // receipts; a Worker transport failure cannot fabricate provider 429.
  return result;
}
/** Add an isolated Tennis shadow rotation every 30 minutes, without
 * reducing existing NFL/CFB polls. No public card or execution authority.
 */
export async function collectKalshiTennisShadowOnce(env,{now=new Date(),fetchImpl=fetch}={}){
  if(!env?.ARCHIVE?.get)return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  const sport=TENNIS_RESEARCH[Math.floor(now.getTime()/(30*60*1000))%2];
  const previous=await readJson(env.ARCHIVE,"sports/"+sport+"-status.json");
  if(ms(previous?.attemptedAt)>now.getTime()-60*60*1000)
    return {ok:false,code:"TENNIS_SHADOW_POLL_NOT_DUE",sport};
  return relaySignedPages(env,{scope:"markets",sport,fetchImpl});
}
export async function collectKalshiExchangeStatusOnce(env,{now=new Date(),fetchImpl=fetch}={}){
  if(!env?.ARCHIVE?.get)return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  const last=await readJson(env.ARCHIVE,"exchange-status.json");
  if(last?.authenticationMode==="SIGNED_PAGES"
    &&ms(last.nextAllowedAt)>now.getTime())
    return {ok:false,code:"KALSHI_STATUS_POLL_NOT_DUE",nextAllowedAt:last.nextAllowedAt};
  return relaySignedPages(env,{scope:"exchange-status",fetchImpl});
}
export async function collectKalshiSeriesCatalogOnce(env,{now=new Date(),fetchImpl=fetch}={}){
  if(!env?.ARCHIVE?.get)return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  const last=await readJson(env.ARCHIVE,"series-catalog-status.json");
  if(last?.version===2&&ms(last?.nextAllowedAt)>now.getTime())
    return {ok:false,code:"KALSHI_CATALOG_POLL_NOT_DUE",nextAllowedAt:last.nextAllowedAt};
  return relaySignedPages(env,{scope:"series-catalog",fetchImpl});
}
export async function collectKalshiEvidenceOnce(env,{now=new Date(),fetchImpl=fetch}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
  return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
 const prior=await readJson(env.ARCHIVE,"evidence-status.json");
 if(ms(prior?.attemptedAt)>now.getTime()-30*60*1000)
  return {ok:true,status:"NOT_DUE"};
 const result=await relaySignedPages(env,{scope:"qualification-evidence",fetchImpl});
 if(!result.ok){
  // A failed Worker -> Pages relay must be observable even if Pages never ran.
  // Never fabricate provider HTTP 429 from a generic transport failure.
  await writeJson(env.ARCHIVE,"evidence-status.json",{
   status:"RELAY_ERROR",code:result.code||"RELAY_UNAVAILABLE",
   httpStatus:result.httpStatus||null,attemptedAt:now.toISOString(),
   sport:null,canQualify:false,canAuthorizeWager:false,
  });
 }
 return result;
}
/** Collect NHL official results only from independently certified R2 scopes. */
export async function collectNhlOfficialResultsOnce(env,{now=new Date(),fetchImpl=fetch}={}){
 if(!env?.ARCHIVE?.get)return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
 let manifest;
 try {const obj=await env.ARCHIVE.get("player-props/official/v1/nhl-scopes.json");manifest=obj?await obj.json():null;}
 catch{return {ok:false,code:"OFFICIAL_SCOPE_READ_FAILED"};}
 if(manifest?.version!==1||manifest.certified!==true||!Array.isArray(manifest.scopes)||!manifest.scopes.length)
  return {ok:true,status:"NOT_CONFIGURED"};
 let receipt;
 try {const obj=await env.ARCHIVE.get("player-props/official/v1/nhl-last-receipt.json");receipt=obj?await obj.json():null;}
 catch{return {ok:false,code:"OFFICIAL_RECEIPT_READ_FAILED"};}
 if(ms(receipt?.checkedAt)>now.getTime()-60*60*1000)return {ok:true,status:"NOT_DUE"};
 return relaySignedPages(env,{scope:"nhl-official-prop-results",fetchImpl});
}
export async function collectReviewedPropGradesOnce(env,{now=new Date(),fetchImpl=fetch}={}){
 if(!env?.ARCHIVE?.get)return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
 let index;
 try{const o=await env.ARCHIVE.get("player-props/reconcile/v1/approved-index.json");index=o?await o.json():null;}
 catch{return {ok:false,code:"RECONCILIATION_INDEX_READ_FAILED"};}
 if(index?.version!==1||index.approved!==true||!Array.isArray(index.entries)||!index.entries.length)
  return {ok:true,status:"NOT_CONFIGURED"};
 let receipt;
 try{const o=await env.ARCHIVE.get("player-props/reconcile/v1/latest-receipt.json");receipt=o?await o.json():null;}
 catch{return {ok:false,code:"RECONCILIATION_RECEIPT_READ_FAILED"};}
 if(ms(receipt?.at)>now.getTime()-60*60*1000)return {ok:true,status:"NOT_DUE"};
 return relaySignedPages(env,{scope:"prop-reconciliation",fetchImpl});
}
export default {
  async scheduled(event,env,ctx){
    // Spread auxiliary provider reads across scheduled windows. Concurrent
    // multivariate / player-prop / tape fanout produced shared provider 429s.
    // Market/tennis collectors keep their existing sport cadence.
    const now=new Date(event?.scheduledTime||Date.now());
    const aux=["player-props","player-props","multilegs","combo-tape",
      "qualification-evidence"][Math.floor(now.getTime()/SLOT_MS)%5];
    ctx.waitUntil(Promise.all([
      collectKalshiPublicOnce(env),collectKalshiTennisShadowOnce(env),
      collectKalshiExchangeStatusOnce(env),collectKalshiSeriesCatalogOnce(env),
      collectNhlOfficialResultsOnce(env,{now}),collectReviewedPropGradesOnce(env,{now}),
      aux==="qualification-evidence"?collectKalshiEvidenceOnce(env):
        relaySignedPages(env,{scope:aux}),
    ]));
  },
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET"||url.pathname!=="/health")
      return Response.json({ok:false,code:"READ_ONLY_HEALTH_ONLY"},{
        status:404,headers:{"cache-control":"no-store"}});
    const [status,evidenceStatus]=await Promise.all([
      readJson(env.ARCHIVE,"collector-status.json"),
      readJson(env.ARCHIVE,"evidence-status.json"),
    ]);
    return Response.json({
      ok:true,readOnly:true,snapshotSource:"R2",
      status:status?.status||"NOT_STARTED",
      authenticationMode:status?.authenticationMode||"UNVERIFIED",
      relayConfigured:typeof env?.FBIS_KALSHI_RELAY_TOKEN==="string"
        &&env.FBIS_KALSHI_RELAY_TOKEN.length>=40,
      sport:status?.sport||null,lastAttemptAt:status?.attemptedAt||null,
      blockedUntil:status?.blockedUntil||null,
      evidenceStatus:evidenceStatus?.status||"NOT_STARTED",
      evidenceAttemptAt:evidenceStatus?.attemptedAt||null,
      evidenceErrorCode:evidenceStatus?.code||null,
      canQualify:false,canAuthorizeWager:false,
    },{headers:{"cache-control":"no-store"}});
  },
};
