/**
 * Polymarket US authenticated read-only stream signing.
 * Docs: timestamp + "GET" + /v1/ws/markets, signed Ed25519; API secret only in runtime env.
 * Never log, serialize, store, or return keys, headers or raw signature.
 */
const PKCS8_PREFIX=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
function bytesFromBase64(source){
  if(typeof source!=="string"||!source)return null;
  const bytes=atob(source.trim());
  return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
function asBase64(bytes){
  const u=new Uint8Array(bytes);
  let s="";for(const b of u)s+=String.fromCharCode(b);
  return btoa(s);
}
export async function signedPolymarketUsHeaders({keyId,secretKey,path="/v1/ws/markets",timestamp=Date.now(),webCrypto=crypto}={}){
  if(!/^[0-9a-f-]{36}$/i.test(keyId||""))throw Error("polymarket-key-id-not-configured");
  if(!["/v1/ws/markets"].includes(path))throw Error("read-only-market-ws-path-only");
  const input=bytesFromBase64(secretKey);
  if(!input||input.length!==64)throw Error("polymarket-secret-not-configured");
  if(!Number.isSafeInteger(timestamp)||timestamp<0)throw Error("invalid-timestamp");
  const pkcs8=new Uint8Array(PKCS8_PREFIX.length+32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(input.subarray(0,32),PKCS8_PREFIX.length);
  const signer=await webCrypto.subtle.importKey("pkcs8",pkcs8,{name:"Ed25519"},false,["sign"]);
  const message=new TextEncoder().encode(String(timestamp)+"GET"+path);
  const signature=await webCrypto.subtle.sign({name:"Ed25519"},signer,message);
  input.fill(0);pkcs8.fill(0);
  return {
    "X-PM-Access-Key":keyId,
    "X-PM-Timestamp":String(timestamp),
    "X-PM-Signature":asBase64(signature)
  };
}
export function polymarketUsSubscribe(slugs,requestId="fbis-market-lite",{fullBook=false,trades=false}={}){
  const clean=[...new Set((slugs||[]).filter(s=>/^[a-z0-9-]{1,160}$/i.test(s)))].slice(0,100);
  if(!clean.length)throw Error("no-valid-market-symbols");
  return {
    subscribe:{
      request_id:requestId,
      subscription_type:trades?"SUBSCRIPTION_TYPE_TRADE":fullBook?"SUBSCRIPTION_TYPE_MARKET_DATA":2,
      market_slugs:clean,
      responses_debounced:!trades
    }
  };
}
export function parsePolymarketUsLite(raw){
  let obj;
  try{obj=typeof raw==="string"?JSON.parse(raw):raw}catch{return null}
  if(!obj||typeof obj!=="object"||obj.error||obj.heartbeat)return null;
  const full=obj.market_data||obj.marketData;
  const data=full||obj.market_data_lite||obj.marketDataLite;
  if(!data?.market_slug&&!data?.marketSlug)return null;
  // Preserve suspended/halted states so a stale open quote cannot survive them.
  const money=v=>{if(v==null||v==="")return null;const n=Number(v&&typeof v==="object"?v.value:v);return Number.isFinite(n)&&n>=0&&n<=1?n:null};
  const slug=String(data.market_slug||data.marketSlug);
  if(!/^[a-z0-9-]{1,160}$/i.test(slug))return null;
  const bid=money(full?data.bids?.[0]?.px:data.best_bid??data.bestBid),ask=money(full?data.offers?.[0]?.px:data.best_ask??data.bestAsk);
  if(bid!==null&&ask!==null&&bid>ask)return null;
  const providerTime=full?(data.transactTime||data.transact_time):null;
  return {marketSlug:slug,bestBid:bid,bestAsk:ask,
    sourceObservedAt:providerTime&&Number.isFinite(Date.parse(providerTime))?new Date(providerTime).toISOString():null,marketState:data.state||null,
    lastTrade:money(data.stats?.lastTradePx??data.stats?.last_trade_px??data.last_trade_px??data.lastTradePx),
    current:money(data.current_px??data.currentPx),
    bidDepth:Number(data.bid_depth??data.bidDepth)||null,
    askDepth:Number(data.ask_depth??data.askDepth)||null,
    ...(full?{book:normalizePolymarketBook(data),stats:normalizePolymarketStats(data.stats||{}),
      stateObserved:true}: {})};
}

/** Strict read-only authenticated account API. NO orders, POST, trading paths. */
export const POLY_US_ACCOUNT_READ_PATHS=Object.freeze([
  "/v1/portfolio/positions",
  "/v1/portfolio/activities",
  "/v1/account/balances"
]);
export async function signedPolymarketUsAccountGetHeaders({
  keyId,secretKey,path,timestamp=Date.now(),webCrypto=crypto
}={}){
  if(!POLY_US_ACCOUNT_READ_PATHS.includes(path))throw Error("private-read-path-not-allowed");
  if(!/^[0-9a-f-]{36}$/i.test(keyId||""))throw Error("polymarket-key-id-not-configured");
  if(!Number.isSafeInteger(timestamp)||timestamp<0)throw Error("invalid-timestamp");
  const input=bytesFromBase64(secretKey);
  if(!input||input.length!==64)throw Error("polymarket-secret-not-configured");
  const pkcs8=new Uint8Array(PKCS8_PREFIX.length+32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(input.subarray(0,32),PKCS8_PREFIX.length);
  try{
    const key=await webCrypto.subtle.importKey("pkcs8",pkcs8,{name:"Ed25519"},false,["sign"]);
    const message=new TextEncoder().encode(String(timestamp)+"GET"+path);
    const sig=await webCrypto.subtle.sign({name:"Ed25519"},key,message);
    return {
      "X-PM-Access-Key":keyId,
      "X-PM-Timestamp":String(timestamp),
      "X-PM-Signature":asBase64(sig)
    };
  }finally{input.fill(0);pkcs8.fill(0)}
}

/** Bounded documented book quantities; retain fractions and never infer units. */
function finiteNonnegative(v){
 const raw=v&&typeof v==="object"?v.value:v;
 if(raw==null||raw==="")return null;
 const n=Number(raw);return Number.isFinite(n)&&n>=0?n:null;
}
export function normalizePolymarketBook(data){
 const levels=(rows,desc)=> (Array.isArray(rows)?rows:[]).map(r=>({
   price:finiteNonnegative(r.px),quantity:finiteNonnegative(r.qty)
 })).filter(r=>r.price!==null&&r.price<=1&&r.quantity!==null)
 .sort((a,b)=>desc?b.price-a.price:a.price-b.price).slice(0,10);
 return {bids:levels(data.bids,true),asks:levels(data.offers,false),quantityUnit:"PROVIDER_CONTRACT_QUANTITY",truncated:true};
}
export function normalizePolymarketStats(s){
 return {lastTrade:finiteNonnegative(s.lastTradePx??s.last_trade_px),
 sharesTraded:finiteNonnegative(s.sharesTraded??s.shares_traded),
 openInterest:finiteNonnegative(s.openInterest??s.open_interest),
 high:finiteNonnegative(s.highPx??s.high_px),low:finiteNonnegative(s.lowPx??s.low_px)};
}
/** Public executed trade only. The book uses YES-side prices for every intent.
 * The trade Amount currency is retained; no notional/share conversion is inferred.
 */
export function parsePolymarketUsTrade(raw){
 let o;try{o=typeof raw==="string"?JSON.parse(raw):raw}catch{return null}
 const t=o?.trade;if(!t)return null;
 const marketSlug=t.marketSlug??t.market_slug;
 const price=finiteNonnegative(t.price),quantity=finiteNonnegative(t.quantity);
 const timestamp=t.tradeTime??t.trade_time;
 if(!/^[a-z0-9-]{1,160}$/i.test(marketSlug||"")||price===null||price>1||!quantity||!Number.isFinite(Date.parse(timestamp)))return null;
 const intent=t.taker?.intent,side=t.taker?.side;
 const direction={ORDER_INTENT_BUY_LONG:1,ORDER_INTENT_SELL_SHORT:1,ORDER_INTENT_SELL_LONG:-1,ORDER_INTENT_BUY_SHORT:-1}[intent]??0;
 const consistent=direction===1?side==="ORDER_SIDE_BUY":direction===-1?side==="ORDER_SIDE_SELL":false;
 return {marketSlug,price,quantity,quantityUnit:t.quantity?.currency?"PROVIDER_AMOUNT_"+t.quantity.currency:"UNKNOWN",
   at:new Date(timestamp).toISOString(),maker:{side:t.maker?.side||null,intent:t.maker?.intent||null},
   taker:{side:side||null,intent:intent||null},direction:consistent?direction:0,
   classificationReason:consistent?"TAKER_SIDE_AND_INTENT_AGREE":"UNKNOWN_OR_CONFLICTING_TAKER",
   providerTradeId:t.tradeId??t.trade_id??t.id??null};
}
