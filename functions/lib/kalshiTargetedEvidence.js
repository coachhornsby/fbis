import {kalshiSignedHeaders,kalshiPrivateKeyPem,KALSHI_BASE} from "./kalshiAccount.js";
import {normalizeKalshiShadowOrderbook,KALSHI_SHADOW_SERIES} from "./kalshiMarketShadow.js";
const ROOT="kalshi/public-shadow/v1/",ID=/^[A-Z0-9_.-]{4,160}$/;
async function read(b,k){try{const o=await b.get(ROOT+k);return o?await o.json():null}catch{return null}}
async function put(b,k,v){await b.put(ROOT+k,JSON.stringify(v),{httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"}})}
async function fetchSigned(env,path,{fetchImpl,webCrypto,now}){
 if(!/^\/trade-api\/v2\/(events\/[A-Z0-9_.-]{4,160}|markets\/[A-Z0-9_.-]{4,160}\/orderbook)$/.test(path))return {ok:false,code:"PATH_NOT_ALLOWED"};
 try{
 const headers=await kalshiSignedHeaders({keyId:env.KALSHI_API_KEY_ID,privateKeyPem:kalshiPrivateKeyPem(env),path,method:"GET",timestamp:now.getTime(),webCrypto});
 const r=await fetchImpl(KALSHI_BASE+path,{method:"GET",redirect:"manual",headers:{accept:"application/json",...headers},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return {ok:false,code:r.status===429?"PROVIDER_RATE_LIMITED":"PROVIDER_ERROR",httpStatus:r.status};
 return {ok:true,body:await r.json()};
 }catch{return {ok:false,code:"FETCH_UNAVAILABLE"}}
}
export async function captureKalshiTargetedEvidence(env,{now=new Date(),fetchImpl=fetch,webCrypto=crypto}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,code:"ARCHIVE_MISSING"};
 if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))return {ok:false,code:"SIGNING_MISSING"};
 const prior=await read(env.ARCHIVE,"evidence-status.json");
 if(prior?.attemptedAt&&Date.parse(prior.attemptedAt)>now.getTime()-1800000)return {ok:true,status:"NOT_DUE"};
 const sport=Math.floor(now.getTime()/1800000)%2?"cfb":"nfl";
 const snap=await read(env.ARCHIVE,"sports/"+sport+".json");
 const valid=snap?.ok===true&&snap.paginationComplete===true&&snap.seriesTicker===KALSHI_SHADOW_SERIES[sport]&&Array.isArray(snap.records);
 const records=valid?snap.records.filter(r=>ID.test(r?.ticker||"")&&ID.test(r?.eventTicker||"")&&r.ticker.startsWith(r.eventTicker+"-")&&r.eventTicker.startsWith(KALSHI_SHADOW_SERIES[sport]+"-")):[];
 const cursor=await read(env.ARCHIVE,"evidence/"+sport+"-cursor.json");
 const index=records.length?(Number.isInteger(cursor?.index)?cursor.index:0)%records.length:0;
 const market=records[index];
 let result={ok:false,code:valid?"NO_VALID_MARKETS":"COMPLETE_SNAPSHOT_REQUIRED"};
 if(market){
  const e=await fetchSigned(env,"/trade-api/v2/events/"+market.eventTicker,{fetchImpl,webCrypto,now});
  if(!e.ok)result=e;
  else if(e.body?.event?.event_ticker!==market.eventTicker)result={ok:false,code:"EVENT_IDENTITY_MISMATCH"};
  else{
   const b=await fetchSigned(env,"/trade-api/v2/markets/"+market.ticker+"/orderbook",{fetchImpl,webCrypto,now});
   if(!b.ok)result=b;
   else{
    const book=normalizeKalshiShadowOrderbook(b.body);
    if(!book)result={ok:false,code:"BOOK_SCHEMA_INVALID"};
    else{
     await put(env.ARCHIVE,"evidence/"+sport+"-latest.json",{version:1,sport,provider:"Kalshi",ticker:market.ticker,eventTicker:market.eventTicker,observedAt:now.toISOString(),event:{event_ticker:market.eventTicker,title:String(e.body.event.title||"").slice(0,180),providerMetadataOnly:true},orderbook:{yesAskDollars:book.yesAskDollars,noAskDollars:book.noAskDollars,yesAskSizeContracts:book.yesAskSizeContracts,noAskSizeContracts:book.noAskSizeContracts},exchangeQuoteTimestamp:null,independentFixtureVerified:false,settlementVerified:false,feesVerified:false,canQualify:false,executionEligible:false,canAuthorizeWager:false});
     await put(env.ARCHIVE,"evidence/"+sport+"-cursor.json",{index:index+1,at:now.toISOString()});
     result={ok:true,status:"EVIDENCE_COLLECTED",sport,ticker:market.ticker};
    }
   }
  }
 }
 await put(env.ARCHIVE,"evidence-status.json",{status:result.ok?"COLLECTED":"BLOCKED",code:result.code||null,sport,attemptedAt:now.toISOString(),httpStatus:result.httpStatus||null,canQualify:false,canAuthorizeWager:false});
 return result;
}
