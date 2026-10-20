/**
 * Authenticated public-market capture inside the Pages runtime, which already
 * has the working Kalshi Ed25519 key as an encrypted binding.
 *
 * No private account fields, signing headers, order methods, or credentials
 * are written to R2 or returned to the scheduled Worker.
 */
import { getKalshiShadowMarketsPage, kalshiShadowAuthority, KALSHI_SHADOW_SERIES } from "./kalshiMarketShadow.js";
import { fetchKalshiExchangeStatus } from "./kalshiExchangeStatus.js";
import {
  kalshiSignedHeaders, kalshiPrivateKeyPem, KALSHI_BASE,
  KALSHI_DIAGNOSTIC_PATHS,
} from "./kalshiAccount.js";

const ROOT="kalshi/public-shadow/v1/";
const SPACING_MS=15*60*1000;
const STATUS_SPACING_MS=60*60*1000;
const SOURCE="SIGNED_PAGES";
const iso=d=>d.toISOString();
const ms=value=>Number.isFinite(Date.parse(value||""))?Date.parse(value):0;
async function readJson(bucket,path){
  try{const x=await bucket.get(ROOT+path);return x?await x.json():null;}catch{return null;}
}
async function writeJson(bucket,path,obj){
  await bucket.put(ROOT+path,JSON.stringify(obj),{
    httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"},
  });
}
export function kalshiSignedReadProxy(env,{fetchImpl=fetch,now=Date.now(),webCrypto=crypto}={}){
  return async (url,options={})=>{
    const uri=new URL(url);
    const allowed=new Set(Object.values(KALSHI_DIAGNOSTIC_PATHS));
    if(uri.origin!==KALSHI_BASE||!allowed.has(uri.pathname)||options.method!=="GET")
      throw new Error("KALSHI_SIGNED_RELAY_PATH_BLOCKED");
    const headers=await kalshiSignedHeaders({
      keyId:env.KALSHI_API_KEY_ID,privateKeyPem:kalshiPrivateKeyPem(env),
      path:uri.pathname,method:"GET",timestamp:now,webCrypto,
    });
    // Redirects must NEVER send Kalshi signed headers to another host.
    return fetchImpl(uri.toString(),{
      method:"GET",headers:{accept:"application/json",...headers},
      redirect:"manual",signal:options.signal||AbortSignal.timeout(12000),
    });
  };
}
const MAX_PAGES_PER_CYCLE=1;
const MAX_TOTAL_PAGES=12;
const MAX_TOTAL_RECORDS=4000;
const PROGRESS_MAX_AGE_MS=4*60*60*1000;
const PAGE_LIMIT=250;
const progressKey=sport=>"sports/"+sport+"-progress.json";
const receiptKey=sport=>"sports/"+sport+"-status.json";
/**
 * A CFB 1,000-row response may exceed the Pages↔Worker relay budget.
 * Checkpoint one 250-row page per 30-minute sport window in R2, then resume.
 * Publish a completed snapshot ONLY after the provider returns an empty cursor.
 * Previously captured records preserve their individual fetchedAt timestamps.
 */
export async function captureSignedKalshiMarkets(env,{sport="nfl",now=new Date(),
  fetchImpl=fetch,webCrypto=crypto}={}){
  if(!["nfl","cfb"].includes(sport))
    return {ok:false,code:"KALSHI_SPORT_NOT_ENABLED"};
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))
    return {ok:false,code:"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED"};
  const previous=await readJson(env.ARCHIVE,"collector-status.json");
  if(previous?.authenticationMode===SOURCE){
    if(ms(previous.blockedUntil)>now.getTime())
      return {ok:false,code:"KALSHI_SIGNED_COOLDOWN",blockedUntil:previous.blockedUntil};
    if(ms(previous.attemptedAt)>now.getTime()-SPACING_MS)
      return {ok:false,code:"KALSHI_SIGNED_POLL_NOT_DUE",lastAttemptAt:previous.attemptedAt};
  }
  const stored=await readJson(env.ARCHIVE,progressKey(sport));
  const active=stored?.version===1 && stored?.sport===sport
    &&Array.isArray(stored.records)
    &&stored.records.length<=MAX_TOTAL_RECORDS
    &&ms(stored.startedAt)>now.getTime()-PROGRESS_MAX_AGE_MS
    &&ms(stored.startedAt)<=now.getTime()
    &&Number.isInteger(stored.pagesFetched)
    &&stored.pagesFetched>0&&stored.pagesFetched<MAX_TOTAL_PAGES
    &&typeof stored.cursor==="string"
    &&Array.isArray(stored.seenCursors)
    &&stored.seenCursors.length<=MAX_TOTAL_PAGES
    &&stored.cursor.length>0&&stored.cursor.length<=2048;
  const progress=active?stored:{
    version:1,sport,startedAt:iso(now),pagesFetched:0,
    cursor:"",seenCursors:[],records:[],invalidRows:0,duplicateRows:0,
  };
  const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});
  let result=null;
  for(let page=0;page<MAX_PAGES_PER_CYCLE;page++){
    result=await getKalshiShadowMarketsPage(sport,{
      cursor:progress.cursor,fetchImpl:proxy,now,limit:PAGE_LIMIT,
    });
    if(!result.ok)break;
    if(result.nextCursor&&(result.nextCursor===progress.cursor||
      progress.seenCursors.includes(result.nextCursor))){
      result={ok:false,code:"KALSHI_PUBLIC_CURSOR_INVALID"};break;
    }
    const tickers=new Set(progress.records.map(r=>r.ticker));
    for(const record of result.records){
      if(tickers.has(record.ticker)){progress.duplicateRows++;continue;}
      if(progress.records.length>=MAX_TOTAL_RECORDS){
        result={ok:false,code:"KALSHI_TOTAL_RECORD_LIMIT"};break;
      }
      progress.records.push(record);tickers.add(record.ticker);
    }
    if(!result.ok)break;
    progress.pagesFetched++;
    progress.invalidRows+=result.invalidRows;
    progress.duplicateRows+=result.duplicateRows;
    if(result.nextCursor){
      progress.seenCursors.push(result.nextCursor);
      progress.cursor=result.nextCursor;
    }else{
      progress.cursor="";
    }
  }
  let blockedUntil=null;
  if(result?.rateLimited){
    blockedUntil=iso(new Date(now.getTime()+60*60*1000));
  }else if(!result?.ok){
    blockedUntil=iso(new Date(now.getTime()+SPACING_MS));
  }
  const complete=!!result?.ok&&progress.cursor==="";
  const state=result?.ok?(complete?"CAPTURED":"PAGINATING"):
    result?.rateLimited?"RATE_LIMITED":"ERROR";
  const receipt={
    source:"Kalshi",collector:"SCHEDULED_WORKER_R2",authenticationMode:SOURCE,
    sport,attemptedAt:iso(now),status:state,
    code:result?.ok?null:result?.code||"KALSHI_PAGE_UNAVAILABLE",
    httpStatus:result?.httpStatus||null,
    rateLimited:!!result?.rateLimited,
    records:progress.records.length,pagesFetched:progress.pagesFetched,
    pageSizeRequested:PAGE_LIMIT,invalidRows:progress.invalidRows,
    duplicateRows:progress.duplicateRows,
    paginationComplete:complete,
    // Source operation health is not an executable price guarantee.
    coverageStartedAt:progress.startedAt,
    blockedUntil,canQualify:false,canAuthorizeWager:false,
    canWriteMarketHistory:false,
  };
  if(result?.ok){
    if(complete){
      const rows=progress.records;
      const oldest=rows.reduce((minimum,r)=>!minimum||ms(r.fetchedAt)<ms(minimum)
        ?r.fetchedAt:minimum,null);
      await writeJson(env.ARCHIVE,"sports/"+sport+".json",{
        ok:true,provider:"Kalshi",sport,seriesTicker:KALSHI_SHADOW_SERIES[sport],
        records:rows,pagesFetched:progress.pagesFetched,
        invalidRows:progress.invalidRows,duplicateRows:progress.duplicateRows,
        paginationComplete:true,coverage:"CURRENT_OPEN_SERIES_PAGED",
        capturedAt:iso(now),oldestMarketFetchedAt:oldest,
        startedAt:progress.startedAt,sourceMethod:"SIGNED_REST_PAGES",
        collector:"SCHEDULED_WORKER_R2",authenticationMode:SOURCE,
        cacheScope:"CENTRAL_R2_READ_ONLY",governance:kalshiShadowAuthority(),
        canQualify:false,canAuthorizeWager:false,
      });
      // A finished traversal must not be resumed with a stale cursor.
      await writeJson(env.ARCHIVE,progressKey(sport),{
        version:1,sport,startedAt:iso(now),pagesFetched:0,cursor:"",
        seenCursors:[],records:[],completedAt:iso(now),
      });
    }else{
      await writeJson(env.ARCHIVE,progressKey(sport),progress);
    }
  }else if(active){
    // Preserve valid existing progress after provider timeout or 429.
    await writeJson(env.ARCHIVE,progressKey(sport),progress);
  }
  await writeJson(env.ARCHIVE,receiptKey(sport),receipt);
  await writeJson(env.ARCHIVE,"collector-status.json",receipt);
  return {ok:!!result?.ok,...receipt};
}
export async function captureSignedKalshiExchangeStatus(env,{now=new Date(),
  fetchImpl=fetch,webCrypto=crypto}={}){
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))
    return {ok:false,code:"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED"};
  const previous=await readJson(env.ARCHIVE,"exchange-status.json");
  if(previous?.authenticationMode===SOURCE
    &&ms(previous.nextAllowedAt)>now.getTime())
    return {ok:false,code:"KALSHI_STATUS_POLL_NOT_DUE",nextAllowedAt:previous.nextAllowedAt};
  const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});
  const result=await fetchKalshiExchangeStatus({fetchImpl:proxy,now});
  const status={
    source:"Kalshi",endpoint:"/exchange/status",authenticationMode:SOURCE,
    observedAt:iso(now),
    state:result.ok?"VERIFIED":result.rateLimited?"RATE_LIMITED":"UNAVAILABLE",
    code:result.ok?null:result.code,
    httpStatus:result.httpStatus||null,
    exchange:result.ok?result.status:null,
    nextAllowedAt:iso(new Date(now.getTime()+
      (result.rateLimited?2*STATUS_SPACING_MS:STATUS_SPACING_MS))),
    canQualify:false,canAuthorizeWager:false,
  };
  await writeJson(env.ARCHIVE,"exchange-status.json",status);
  return {ok:result.ok,state:status.state,code:status.code,observedAt:status.observedAt};
}

/**
 * Daily signed series discovery, strictly research-only. The official
 * /series?category=Sports endpoint lists category templates and cannot
 * establish game/side/player identity, quote depth, or settlement parity.
 */
export async function captureKalshiSportsSeriesCatalog(env,{now=new Date(),
  fetchImpl=fetch,webCrypto=crypto}={}){
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))
    return {ok:false,code:"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED"};
  const previous=await readJson(env.ARCHIVE,"series-catalog-status.json");
  if(previous?.version===2&&ms(previous?.nextAllowedAt)>now.getTime())
    return {ok:false,code:"KALSHI_CATALOG_POLL_NOT_DUE",nextAllowedAt:previous.nextAllowedAt};
  const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});
  let result={ok:false,code:"KALSHI_CATALOG_HTTP_UNAVAILABLE"};
  try{
    const url=new URL(KALSHI_BASE+"/trade-api/v2/series");
    url.searchParams.set("category","Sports");
    const response=await proxy(url.toString(),{method:"GET"});
    if(response.status===429){
      result={ok:false,code:"KALSHI_CATALOG_RATE_LIMITED",httpStatus:429};
    }else if(!response.ok){
      result={ok:false,code:"KALSHI_CATALOG_HTTP_ERROR",httpStatus:response.status};
    }else{
      const body=await response.json();
      if(!body||!Array.isArray(body.series)) {
        result={ok:false,code:"KALSHI_CATALOG_SCHEMA_UNAVAILABLE"};
      } else {
        const seen=new Set();
        const records=[];
        for(const value of body.series){
          const ticker=String(value?.ticker||"");
          if(!/^[A-Z0-9_.-]{4,120}$/.test(ticker)||seen.has(ticker))continue;
          seen.add(ticker);
          if(records.length>=7000)continue;
          records.push({
            ticker,title:String(value.title||"").slice(0,180),
            category:String(value.category||"").slice(0,100),
            categories:Array.isArray(value.categories)?value.categories.slice(0,12)
              .map(x=>String(x).slice(0,80)):[],
            tags:Array.isArray(value.tags)?value.tags.slice(0,12)
              .map(x=>String(x).slice(0,80)):[],
            // No settlement URLs or fee claims qualified for wagering.
            canQualify:false,executionEligible:false,
          });
        }
        const receipt={
          ok:true,provider:"Kalshi",categoryFilter:"Sports",
          observedAt:iso(now),records,
          reportedSeries:body.series.length,storedSeries:records.length,
          truncated:seen.size>records.length,
          coverage:"PROVIDER_SPORTS_SERIES_DISCOVERY_ONLY",
          canQualify:false,canAuthorizeWager:false,
        };
        await writeJson(env.ARCHIVE,"series-catalog.json",receipt);
        result={ok:true,reportedSeries:receipt.reportedSeries,
          storedSeries:receipt.storedSeries,truncated:receipt.truncated};
      }
    }
  }catch{
    result={ok:false,code:"KALSHI_CATALOG_CONNECTION_FAILED"};
  }
  await writeJson(env.ARCHIVE,"series-catalog-status.json",{
    version:2,
    status:result.ok?"DISCOVERED":result.httpStatus===429?"RATE_LIMITED":"UNAVAILABLE",
    observedAt:iso(now),code:result.ok?null:result.code,
    httpStatus:result.httpStatus||null,
    nextAllowedAt:iso(new Date(now.getTime()+(result.ok?24:6)*60*60*1000)),
    storedSeries:result.storedSeries??null,
    canQualify:false,canAuthorizeWager:false,
  });
  return result;
}
