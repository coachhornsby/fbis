import { KALSHI_PROP_SERIES } from './propProviderAdapters.js';
import { kalshiSignedReadProxy } from './kalshiSignedCollector.js';
const ROOT='player-props/kalshi/v1/';
export async function captureKalshiPlayerProps(env,{now=new Date(),fetchImpl=fetch,webCrypto=crypto,maxSeries=4}={}) {
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)return {ok:false,code:'ARCHIVE_BINDING_MISSING'};
 const previous=await env.ARCHIVE.get(ROOT+'status.json');const status=previous?await previous.json():null;
 if(Date.parse(status?.nextAllowedAt)>now.getTime())return {ok:true,status:'NOT_DUE',records:0};
 const catObj=await env.ARCHIVE.get('kalshi/public-shadow/v1/series-catalog.json');const catalog=catObj?await catObj.json():null;
 if(!catalog?.ok||!Array.isArray(catalog.records))return {ok:false,code:'SERIES_DISCOVERY_UNAVAILABLE'};
 const available=new Set(catalog.records.map(r=>r.ticker));const series=Object.keys(KALSHI_PROP_SERIES).filter(s=>available.has(s));
 const offset=Number.isInteger(status?.nextOffset)?status.nextOffset%Math.max(1,series.length):0;
 const selected=Array.from({length:Math.min(maxSeries,series.length)},(_,i)=>series[(offset+i)%series.length]);
 const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});const receipts=[];
 for(const ticker of selected){
  try {
   const response=await proxy(`https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=${encodeURIComponent(ticker)}&status=open&limit=1000`,{method:'GET'});
   if(response.status===429){receipts.push({series:ticker,status:'RATE_LIMITED',records:0});break;}
   if(!response.ok){receipts.push({series:ticker,status:'HTTP_ERROR',httpStatus:response.status,records:0});continue;}
   const data=await response.json();if(!Array.isArray(data.markets))throw Error('SCHEMA_CHANGED');
   const records=data.markets.filter(m=>String(m.ticker||'').startsWith(ticker+'-')&&!m.mve_collection_ticker).slice(0,1000);
   const receipt={version:1,provider:'Kalshi',seriesTicker:ticker,sport:KALSHI_PROP_SERIES[ticker][0],capturedAt:now.toISOString(),
    sourceObservedAt:null,quoteTimeBasis:'REST_CAPTURE_ONLY',records,paginationComplete:!data.cursor,canQualify:false,canAuthorizeWager:false};
   await env.ARCHIVE.put(ROOT+ticker+'.json',JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
   receipts.push({series:ticker,status:'CAPTURED',records:records.length,paginationComplete:receipt.paginationComplete});
  }catch{receipts.push({series:ticker,status:'UNAVAILABLE',records:0});}
 }
 const rateLimited=receipts.some(r=>r.status==='RATE_LIMITED');
 const result={ok:receipts.some(r=>r.status==='CAPTURED'),version:1,attemptedAt:now.toISOString(),nextAllowedAt:new Date(now.getTime()+(rateLimited?3600000:14*60000)).toISOString(),
  nextOffset:(offset+selected.length)%Math.max(1,series.length),discoveredSeries:series.length,receipts,records:receipts.reduce((n,r)=>n+r.records,0),canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(ROOT+'status.json',JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});return result;
}
export async function loadCapturedKalshiProps(env,{games,players,sport='all',seriesFilter=null,now=Date.now()}={}) {
 const {mapKalshiPlayerContract}=await import('./propProviderAdapters.js');
 const rows=[],rejected=[],coverage=[];
 if(!env.ARCHIVE?.get)return {rows,rejected,coverage,error:'ARCHIVE_UNBOUND'};
 for(const [series,[s]] of Object.entries(KALSHI_PROP_SERIES)){
  if((sport!=='all'&&sport!==s)||(seriesFilter&&series!==seriesFilter))continue;
  try{const obj=await env.ARCHIVE.get(ROOT+series+'.json');if(!obj){coverage.push({series,sport:s,status:'NOT_CAPTURED'});continue;}
   const snap=await obj.json(),age=now-Date.parse(snap.capturedAt);
   if(!Array.isArray(snap.records)||!Number.isFinite(age)||age<0||age>2*3600000){coverage.push({series,sport:s,status:'STALE'});continue;}
   coverage.push({series,sport:s,status:snap.paginationComplete?'CAPTURED':'PARTIAL',capturedAt:snap.capturedAt,records:snap.records.length});
   for(const raw of snap.records){const mapped=mapKalshiPlayerContract(raw,{games,players,capturedAt:snap.capturedAt,seriesTicker:series});if(!mapped)continue;if(mapped.rejected)rejected.push(mapped);else if(Date.parse(mapped.start_time)>now){
     rows.push(mapped);
     const noAsk=Number(raw.no_ask_dollars),yesBid=Number(raw.yes_bid_dollars),yesBidSize=Number(raw.yes_bid_size_fp);
     if(raw.no_ask_dollars!=null&&raw.yes_bid_dollars!=null&&noAsk>0&&noAsk<1&&Math.abs(noAsk-(1-yesBid))<0.00001&&yesBidSize>0)
      rows.push({...mapped,id:`kalshi:${raw.ticker}:no`,side:'no',statSide:'under',observedAsk:noAsk,observedBid:Number(raw.no_bid_dollars),observedDepth:yesBidSize});
    }}
  }catch{coverage.push({series,sport:s,status:'READ_FAILED'});}
 }
 return {rows,rejected,coverage};
}
