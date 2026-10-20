/**
 * Kalshi multi-leg market discovery from the official public multivariate feed.
 * No RFQ creation, quote acceptance, synthetic multiplication, or trade authority.
 * Bounded one page per scheduled invocation; checkpoint cursor never publishes
 * partial coverage as complete. Only provider-declared legs are accepted.
 */
const ROOT="player-props/kalshi/v1/",BASE="https://external-api.kalshi.com/trade-api/v2";
const ticker=x=>typeof x==="string"&&/^[A-Z0-9_.-]{4,160}$/.test(x);
const read=async(b,k)=>{try{const x=await b.get(ROOT+k);return x?await x.json():null}catch{return null}};
const write=(b,k,x)=>b.put(ROOT+k,JSON.stringify(x),{httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"}});
export function normalizeKalshiMultileg(m,event){
 const legs=m?.mve_selected_legs;
 if(!ticker(m?.ticker)||!ticker(m?.event_ticker)||!Array.isArray(legs)||legs.length<2||legs.length>12)return null;
 if(m.event_ticker!==event?.event_ticker)return null;
 const selected=legs.map(l=>({marketTicker:l?.market_ticker,eventTicker:l?.event_ticker,side:String(l?.side||"").toLowerCase()}));
 if(selected.some(l=>!ticker(l.marketTicker)||!ticker(l.eventTicker)||!["yes","no"].includes(l.side)))return null;
 if(new Set(selected.map(l=>l.marketTicker+":"+l.side)).size!==selected.length)return null;
 const n=Number(m.yes_ask_dollars),depth=Number(m.yes_ask_size_fp);
 return {ticker:m.ticker,eventTicker:m.event_ticker,collectionTicker:ticker(m.mve_collection_ticker)?m.mve_collection_ticker:null,
  title:String(m.title||event.title||"").slice(0,180),legs:selected,legCount:selected.length,
  providerAskDollars:m.yes_ask_dollars!=null&&Number.isFinite(n)&&n>=0&&n<=1?n:null,
  indicativeAskSize:m.yes_ask_size_fp!=null&&Number.isFinite(depth)&&depth>=0?depth:null,
  pricingMethod:"VENUE_OBSERVED_MVE_ONLY",rfqRequiredForCustomCombination:true,
  rfqQuoteVerified:false,legSettlementVerified:false,jointModelProbability:null,netEdge:null,
  feesVerified:false,canQualify:false,executionEligible:false,canAuthorizeWager:false};
}
export async function captureKalshiMultilegs(env,{now=new Date(),fetchImpl=fetch}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,code:"ARCHIVE_MISSING"};
 const previous=await read(env.ARCHIVE,"multi-status.json");
 if(Date.parse(previous?.nextAllowedAt)>now.getTime())return {ok:true,status:"NOT_DUE"};
 const progress=await read(env.ARCHIVE,"multi-progress.json");
 const cursor=progress?.cursor&&typeof progress.cursor==="string"&&progress.cursor.length<=2048?progress.cursor:"";
 const url=new URL(BASE+"/events/multivariate");
 url.searchParams.set("limit","100");url.searchParams.set("with_nested_markets","true");
 if(cursor)url.searchParams.set("cursor",cursor);
 let result={ok:false,code:"MULTIVARIATE_UNAVAILABLE"};
 try{
  const response=await fetchImpl(url.toString(),{method:"GET",redirect:"manual",headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(response.ok){
   const data=await response.json();
   if(!Array.isArray(data?.events)||typeof data.cursor!=="string"||data.cursor.length>2048)result={ok:false,code:"MULTIVARIATE_SCHEMA_INVALID"};
   else if(data.cursor&&data.cursor===cursor)result={ok:false,code:"MULTIVARIATE_CURSOR_LOOP"};
   else{
    const records=[];const seen=new Set();
    for(const event of data.events.slice(0,100)){
     if(!ticker(event?.event_ticker)||!Array.isArray(event.markets))continue;
     for(const m of event.markets.slice(0,100)){
      const row=normalizeKalshiMultileg(m,event);
      if(!row||seen.has(row.ticker))continue;seen.add(row.ticker);records.push(row);
     }
    }
    const existing=cursor&&Array.isArray(progress?.records)?progress.records:[];
    const combined=[...new Map([...existing,...records].map(r=>[r.ticker,r])).values()].slice(0,3000);
    const complete=!data.cursor;
    if(complete){
     await write(env.ARCHIVE,"multi-snapshot.json",{version:1,provider:"Kalshi",capturedAt:now.toISOString(),records:combined,
      paginationComplete:true,authority:"RESEARCH_ONLY",canAuthorizeWager:false});
     await write(env.ARCHIVE,"multi-progress.json",{cursor:"",records:[],pages:0});
    }else{
     await write(env.ARCHIVE,"multi-progress.json",{cursor:data.cursor,records:combined,
      pages:(cursor?progress?.pages||0:0)+1,startedAt:cursor?progress?.startedAt:now.toISOString()});
    }
    result={ok:true,status:complete?"CAPTURED":"PAGINATING",records:combined.length,paginationComplete:complete};
   }
  }else result={ok:false,code:response.status===429?"MULTIVARIATE_RATE_LIMITED":"MULTIVARIATE_HTTP_ERROR",httpStatus:response.status};
 }catch{result={ok:false,code:"MULTIVARIATE_FETCH_FAILED"}}
 await write(env.ARCHIVE,"multi-status.json",{...result,attemptedAt:now.toISOString(),
  nextAllowedAt:new Date(now.getTime()+(result.httpStatus===429?3600000:15*60000)).toISOString(),canQualify:false,canAuthorizeWager:false});
 return result;
}
