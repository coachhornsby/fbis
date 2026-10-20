/**
 * Combo Tape research: actual public trade prints only.
 * Unlike combo listings, each row requires a venue trade ID and execution
 * timestamp. No RFQ submission, account endpoint, or wager authority.
 */
const ROOT="player-props/kalshi/v1/",BASE="https://external-api.kalshi.com/trade-api/v2";
const key=x=>typeof x==="string"&&/^[A-Z0-9_.-]{4,160}$/.test(x);
const stamp=x=>{const v=Date.parse(x||"");return Number.isFinite(v)?new Date(v).toISOString():null};
const load=async(b,k)=>{try{const o=await b.get(ROOT+k);return o?await o.json():null}catch{return null}};
const save=(b,k,x)=>b.put(ROOT+k,JSON.stringify(x),{httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"}});
export function normalizeComboTrade(raw,combo){
 if(!key(raw?.ticker)||raw.ticker!==combo?.ticker||typeof raw.trade_id!=="string"||raw.trade_id.length<8)return null;
 const t=stamp(raw.created_time),price=Number(raw.yes_price_dollars),size=Number(raw.count_fp);
 if(!t||raw.yes_price_dollars==null||raw.count_fp==null||!Number.isFinite(price)||price<0||price>1||!Number.isFinite(size)||size<=0)return null;
 return {tradeId:raw.trade_id.slice(0,100),ticker:raw.ticker,executedAt:t,yesPriceDollars:price,
  contracts:size,notionalDollars:Number((price*size).toFixed(6)),isBlockTrade:raw.is_block_trade===true,
  takerOutcomeSide:["yes","no"].includes(raw.taker_outcome_side)?raw.taker_outcome_side:null,
  legs:combo.legs,legCount:combo.legs.length,collectionTicker:combo.collectionTicker||null,
  marketFamily:"COMBO",quoteKind:"EXECUTED_PUBLIC_PRINT",exchangeQuoteTimestamp:null,
  providerExecutionTime:t,independentFixtureVerified:false,settlementVerified:false,
  feeAdjustedEdge:null,canQualify:false,canAuthorizeWager:false,executionEligible:false};
}
export async function captureKalshiComboTape(env,{fetchImpl=fetch,now=new Date()}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,code:"ARCHIVE_UNBOUND"};
 const previous=await load(env.ARCHIVE,"combo-tape-status.json");
 if(Date.parse(previous?.nextAllowedAt)>now.getTime())return {ok:true,status:"NOT_DUE"};
 const snapshot=await load(env.ARCHIVE,"multi-snapshot.json");
 const markets=snapshot?.paginationComplete===true&&Array.isArray(snapshot?.records)?snapshot.records:[];
 let result={ok:false,code:"COMBO_SNAPSHOT_NOT_READY"};
 if(markets.length){
  const cursor=await load(env.ARCHIVE,"combo-tape-cursor.json");
  const index=(Number.isInteger(cursor?.index)&&cursor.index>=0?cursor.index:0)%markets.length;
  const combo=markets[index];
  if(key(combo?.ticker)&&Array.isArray(combo.legs)&&combo.legs.length>=2){
   const url=new URL(BASE+"/markets/trades");url.searchParams.set("ticker",combo.ticker);url.searchParams.set("limit","100");
   try{
    const r=await fetchImpl(url.toString(),{method:"GET",redirect:"manual",headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
    if(r.ok){
     const body=await r.json();
     if(!Array.isArray(body?.trades))result={ok:false,code:"TRADES_SCHEMA_INVALID"};
     else {
      const rows=body.trades.map(x=>normalizeComboTrade(x,combo)).filter(Boolean);
      const existing=await load(env.ARCHIVE,"combo-tape.json");
      const prior=Array.isArray(existing?.records)?existing.records:[];
      const merged=[...new Map([...prior,...rows].map(x=>[x.tradeId,x])).values()].sort((a,b)=>b.executedAt.localeCompare(a.executedAt)).slice(0,500);
      await save(env.ARCHIVE,"combo-tape.json",{version:1,provider:"Kalshi",capturedAt:now.toISOString(),
       records:merged,sampledMarketCount:1,fullTradeTapeCoverage:false,source:"PUBLIC_REST_TRADES",
       canQualify:false,canAuthorizeWager:false});
      await save(env.ARCHIVE,"combo-tape-cursor.json",{index:index+1,at:now.toISOString()});
      result={ok:true,status:"SAMPLED",marketTicker:combo.ticker,newTrades:rows.length,storedTrades:merged.length};
     }
    }else result={ok:false,code:r.status===429?"TRADES_RATE_LIMITED":"TRADES_HTTP_ERROR",httpStatus:r.status};
   }catch{result={ok:false,code:"TRADES_FETCH_FAILED"}}
  }
 }
 await save(env.ARCHIVE,"combo-tape-status.json",{...result,attemptedAt:now.toISOString(),nextAllowedAt:new Date(now.getTime()+(result.httpStatus===429?3600000:15*60000)).toISOString(),canQualify:false,canAuthorizeWager:false});
 return result;
}
