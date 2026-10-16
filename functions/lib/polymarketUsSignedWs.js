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
/** Max slugs per single subscribe frame (existing client batch bound). */
export const POLYMARKET_US_SUBSCRIBE_BATCH_MAX=50;

export function polymarketUsSubscribe(slugs,requestId="fbis-market-lite",{fullBook=false,maxBatch=POLYMARKET_US_SUBSCRIBE_BATCH_MAX}={}){
  const limit=Math.max(1,Math.min(POLYMARKET_US_SUBSCRIBE_BATCH_MAX,Math.floor(Number(maxBatch)||POLYMARKET_US_SUBSCRIBE_BATCH_MAX)));
  const clean=[...new Set((slugs||[]).filter(s=>/^[a-z0-9-]{1,160}$/i.test(s)))].slice(0,limit);
  if(!clean.length)throw Error("no-valid-market-symbols");
  return {
    subscribe:{
      request_id:requestId,
      subscription_type:fullBook?"SUBSCRIPTION_TYPE_MARKET_DATA":2,
      market_slugs:clean,
      responses_debounced:true
    }
  };
}

/** Split an arbitrary eligible slug list into valid subscribe frames (≤50 each). */
export function polymarketUsSubscribeBatches(slugs,requestId="fbis-market-lite",{fullBook=false,maxBatch=POLYMARKET_US_SUBSCRIBE_BATCH_MAX}={}){
  const clean=[...new Set((slugs||[]).filter(s=>/^[a-z0-9-]{1,160}$/i.test(s)))];
  if(!clean.length)throw Error("no-valid-market-symbols");
  const size=Math.max(1,Math.min(POLYMARKET_US_SUBSCRIBE_BATCH_MAX,Math.floor(Number(maxBatch)||POLYMARKET_US_SUBSCRIBE_BATCH_MAX)));
  const frames=[];
  for(let i=0;i<clean.length;i+=size){
    frames.push(polymarketUsSubscribe(clean.slice(i,i+size),`${requestId}-${frames.length}`,{fullBook,maxBatch:size}));
  }
  return frames;
}
export function parsePolymarketUsLite(raw){
  let obj;
  try{obj=typeof raw==="string"?JSON.parse(raw):raw}catch{return null}
  if(!obj||typeof obj!=="object"||obj.error||obj.heartbeat)return null;
  const full=obj.market_data||obj.marketData;
  const data=full||obj.market_data_lite||obj.marketDataLite;
  if(!data?.market_slug&&!data?.marketSlug)return null;
  if(full&&data.state!=="MARKET_STATE_OPEN")return null;
  const money=v=>{if(v==null||v==="")return null;const n=Number(v&&typeof v==="object"?v.value:v);return Number.isFinite(n)&&n>=0&&n<=1?n:null};
  const slug=String(data.market_slug||data.marketSlug);
  if(!/^[a-z0-9-]{1,160}$/i.test(slug))return null;
  const bid=money(full?data.bids?.[0]?.px:data.best_bid??data.bestBid),ask=money(full?data.offers?.[0]?.px:data.best_ask??data.bestAsk);
  if(bid!==null&&ask!==null&&bid>ask)return null;
  const providerTime=full?(data.transactTime||data.transact_time):null;
  return {marketSlug:slug,bestBid:bid,bestAsk:ask,
    sourceObservedAt:providerTime&&Number.isFinite(Date.parse(providerTime))?new Date(providerTime).toISOString():null,marketState:data.state||null,
    lastTrade:money(data.last_trade_px??data.lastTradePx),
    current:money(data.current_px??data.currentPx),
    bidDepth:Number(data.bid_depth??data.bidDepth)||null,
    askDepth:Number(data.ask_depth??data.askDepth)||null};
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
