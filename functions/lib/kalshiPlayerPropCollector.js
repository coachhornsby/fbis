import { KALSHI_PROP_SERIES, mapKalshiPlayerContract } from './propProviderAdapters.js';
import { captureNbaPregameMarketLines } from './nbaPropMarketFreeze.js';
import { loadPropFixturesAndPlayers } from './propResearchData.js';
import { chicagoDayBounds } from './chicagoDayBounds.js';
import { kalshiSignedReadProxy } from './kalshiSignedCollector.js';
const ROOT='player-props/kalshi/v1/';
const chicagoDay = instant => new Intl.DateTimeFormat('en-CA',{
 timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(instant));
const historicalKey = (series,day) => ROOT+'history/'+day+'/'+series+'.json';
function ruleStart(primary){
 const m=/originally scheduled for ([A-Z][a-z]{2} \d{1,2}, \d{4}) at (\d{1,2}:\d{2} [AP]M) (EDT|EST)/.exec(primary||'');
 if(!m)return null;
 const time=Date.parse(m[1]+' '+m[2]+' GMT'+(m[3]==='EDT'?'-0400':'-0500'));
 return Number.isFinite(time)?time:null;
}
export async function captureKalshiPlayerProps(env,{now=new Date(),fetchImpl=fetch,webCrypto=crypto,maxSeries=6,maxPages=5}={}) {
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)return {ok:false,code:'ARCHIVE_BINDING_MISSING'};
 const previous=await env.ARCHIVE.get(ROOT+'status.json');const status=previous?await previous.json():null;
 if(Date.parse(status?.nextAllowedAt)>now.getTime())return {ok:true,status:'NOT_DUE',records:0};
 const catObj=await env.ARCHIVE.get('kalshi/public-shadow/v1/series-catalog.json');const catalog=catObj?await catObj.json():null;
 if(!catalog?.ok||!Array.isArray(catalog.records))return {ok:false,code:'SERIES_DISCOVERY_UNAVAILABLE'};
 const available=new Set(catalog.records.map(r=>r.ticker));const series=Object.keys(KALSHI_PROP_SERIES).filter(s=>available.has(s));
 const offset=Number.isInteger(status?.nextOffset)?status.nextOffset%Math.max(1,series.length):0;
 const selected=Array.from({length:Math.min(maxSeries,series.length)},(_,i)=>series[(offset+i)%series.length]);
 const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});const receipts=[],nbaCaptures=[];
 for(const ticker of selected){
  try {
   let cursor='',pages=0,complete=false,rateLimited=false;const records=[],seen=new Set(),cursors=new Set();
   do {
    const q=new URLSearchParams({series_ticker:ticker,status:'open',mve_filter:'exclude',limit:'1000'});if(cursor)q.set('cursor',cursor);
    const response=await proxy('https://external-api.kalshi.com/trade-api/v2/markets?'+q,{method:'GET'});
    if(response.status===429){rateLimited=true;break;}
    if(!response.ok)throw Error('HTTP_'+response.status);
    const data=await response.json();if(!Array.isArray(data.markets))throw Error('SCHEMA_CHANGED');
    pages++;
    for(const m of data.markets)if(String(m.ticker||'').startsWith(ticker+'-')&&!m.mve_collection_ticker&&!seen.has(m.ticker)){seen.add(m.ticker);records.push(m);}
    cursor=typeof data.cursor==='string'?data.cursor:'';
    if(!cursor){complete=true;break;}
    if(cursors.has(cursor))break;cursors.add(cursor);
   }while(pages<Math.min(10,Math.max(1,maxPages)));
   if(rateLimited){receipts.push({series:ticker,status:'RATE_LIMITED',records:0});break;}
   const receipt={version:1,provider:'Kalshi',seriesTicker:ticker,sport:KALSHI_PROP_SERIES[ticker][0],capturedAt:now.toISOString(),
    sourceObservedAt:null,quoteTimeBasis:'REST_CAPTURE_ONLY',records,pages,paginationComplete:complete,canQualify:false,canAuthorizeWager:false};
   // Immutable-by-event historical inventory: keep the last pregame observation
   // for each exact contract. The rolling 2-hour snapshot is not historical storage.
   const eventDays=new Map();
   for(const market of records){
    const day=/originally scheduled for ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(market.rules_primary||'');
    const d=day?new Date(day[1]+' 12:00:00 GMT').toISOString().slice(0,10):null;
    if(!d || !/^\d{4}-\d{2}-\d{2}$/.test(d))continue;
    if(!eventDays.has(d))eventDays.set(d,[]);
    eventDays.get(d).push(market);
   }
   for(const [day,markets] of eventDays){
    const key=historicalKey(ticker,day);
    const old=await env.ARCHIVE.get(key);
    const prior=old?await old.json():null;
    const byTicker=new Map((Array.isArray(prior?.records)?prior.records:[]).map(m=>[m.ticker,m]));
    let additions=0;
    // Preserve the observed pregame snapshot, not a postgame close price.
    for(const m of markets){
      const kickoff=ruleStart(m.rules_primary);
      if(kickoff==null || now.getTime()>=kickoff)continue;
      byTicker.set(m.ticker,m);additions++;
    }
    if(!additions)continue;
    await env.ARCHIVE.put(key,JSON.stringify({
      version:1,seriesTicker:ticker,sport:KALSHI_PROP_SERIES[ticker][0],
      capturedAt:now.toISOString(),historical:true,records:[...byTicker.values()]
    }),{httpMetadata:{contentType:'application/json'}});
   }
   await env.ARCHIVE.put(ROOT+ticker+'.json',JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
   if(KALSHI_PROP_SERIES[ticker][0]==='nba' && complete)
     nbaCaptures.push({ticker,records});
   receipts.push({series:ticker,status:complete?'CAPTURED':'PARTIAL',records:records.length,pages,paginationComplete:receipt.paginationComplete});
  }catch{receipts.push({series:ticker,status:'UNAVAILABLE',records:0});}
 }
 // Only fully paginated, exactly roster/event matched NBA contracts can enter
 // the last-observed-before-tip ledger. The raw Kalshi snapshot is NOT a quote clock.
 const nbaFrozen=[];
 if(nbaCaptures.length){
  const localDate=chicagoDay(now);
  // Noon UTC is always inside its named America/Chicago calendar day;
  // advancing that anchor one UTC day avoids skipping Sunday on late nights.
  const nextLocalDate=chicagoDay(new Date(Date.parse(localDate+'T12:00:00Z')+86400000));
  for(const day of [...new Set([localDate,nextLocalDate])]){
   try{
    const bounds=chicagoDayBounds(day);
    const context=await loadPropFixturesAndPlayers(env,{start:bounds.start,end:bounds.end,sport:'nba'});
    const lines=[];
    for(const snapshot of nbaCaptures)for(const raw of snapshot.records){
     const mapped=mapKalshiPlayerContract(raw,{...context,capturedAt:now.toISOString(),seriesTicker:snapshot.ticker});
     if(!mapped||mapped.rejected||!context.games.some(g=>String(g.id)===mapped.canonicalEventId))continue;
     lines.push(mapped);
     const noAsk=Number(raw.no_ask_dollars),yesBid=Number(raw.yes_bid_dollars),noSize=Number(raw.yes_bid_size_fp);
     if(raw.no_ask_dollars!=null&&raw.yes_bid_dollars!=null&&noAsk>0&&noAsk<1&&
        Math.abs(noAsk-(1-yesBid))<0.00001&&noSize>0)
      lines.push({...mapped,id:'kalshi:'+raw.ticker+':no',side:'no',statSide:'under',
       observedAsk:noAsk,observedBid:Number(raw.no_bid_dollars),observedDepth:noSize});
    }
    const frozen=await captureNbaPregameMarketLines(env,{provider:'Kalshi',date:day,rows:lines,now});
    nbaFrozen.push({date:day,...frozen});
   }catch{nbaFrozen.push({date:day,ok:false,reason:'NBA_FREEZE_CAPTURE_FAILED'});}
  }
 }
 const rateLimited=receipts.some(r=>r.status==='RATE_LIMITED');
 const result={ok:receipts.some(r=>r.status==='CAPTURED'||r.status==='PARTIAL'),version:1,attemptedAt:now.toISOString(),nextAllowedAt:new Date(now.getTime()+(rateLimited?3600000:14*60000)).toISOString(),
  nextOffset:(offset+receipts.filter(r=>r.status!=='RATE_LIMITED').length)%Math.max(1,series.length),discoveredSeries:series.length,receipts,nbaPregameLineFreeze:nbaFrozen,records:receipts.reduce((n,r)=>n+r.records,0),canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(ROOT+'status.json',JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});return result;
}
export async function loadCapturedKalshiProps(env,{games,players,sport='all',seriesFilter=null,now=Date.now(),date=null}={}) {
 const {mapKalshiPlayerContract}=await import('./propProviderAdapters.js');
 const rows=[],rejected=[],coverage=[];
 if(!env.ARCHIVE?.get)return {rows,rejected,coverage,error:'ARCHIVE_UNBOUND'};
 for(const [series,[s]] of Object.entries(KALSHI_PROP_SERIES)){
  if((sport!=='all'&&sport!==s)||(seriesFilter&&series!==seriesFilter))continue;
  try{const historicalObj=date?await env.ARCHIVE.get(historicalKey(series,date)):null;
   const historic=Boolean(historicalObj);
   const obj=historicalObj||await env.ARCHIVE.get(ROOT+series+'.json');if(!obj){coverage.push({series,sport:s,status:'NOT_CAPTURED'});continue;}
   const snap=await obj.json(),age=now-Date.parse(snap.capturedAt);
   if(!Array.isArray(snap.records)||!Number.isFinite(age)||age<0||(!historic&&!date&&age>2*3600000)){coverage.push({series,sport:s,status:'STALE'});continue;}
   coverage.push({series,sport:s,status:snap.paginationComplete?'CAPTURED':'PARTIAL',capturedAt:snap.capturedAt,records:snap.records.length,historical:historic});
   for(const raw of snap.records){const mapped=mapKalshiPlayerContract(raw,{games,players,capturedAt:snap.capturedAt,seriesTicker:series});if(!mapped)continue;if(mapped.rejected)rejected.push(mapped);else if(date || Date.parse(mapped.start_time)>now){
     rows.push(mapped);
     const noAsk=Number(raw.no_ask_dollars),yesBid=Number(raw.yes_bid_dollars),yesBidSize=Number(raw.yes_bid_size_fp);
     if(raw.no_ask_dollars!=null&&raw.yes_bid_dollars!=null&&noAsk>0&&noAsk<1&&Math.abs(noAsk-(1-yesBid))<0.00001&&yesBidSize>0)
      rows.push({...mapped,id:`kalshi:${raw.ticker}:no`,side:'no',statSide:'under',observedAsk:noAsk,observedBid:Number(raw.no_bid_dollars),observedDepth:yesBidSize});
    }}
  }catch{coverage.push({series,sport:s,status:'READ_FAILED'});}
 }
 return {rows,rejected,coverage};
}
