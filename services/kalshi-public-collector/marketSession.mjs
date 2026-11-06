export const KALSHI_STREAM_JOB='services/kalshi-public-collector/marketSession.mjs';
export const KALSHI_STREAM_KEY='kalshi/public-shadow/v1/market-ws/latest.json';
const root='kalshi/public-shadow/v1/sports/';
const sports=['nba','nfl','cfb','cbb','nhl'];
const age=(t,now)=>{const v=Date.parse(t||'');return Number.isFinite(v)&&v<=now?now-v:Infinity;};
export async function runKalshiMarketSession(env,lease,{fetchImpl=fetch,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const start=now(),tickers=new Set(),groups=[];
 for(const sport of sports){
  const o=await env.ARCHIVE.get(root+sport+'.json');if(!o)continue;
  const v=await o.json();
  if(v?.ok!==true||v.sport!==sport||age(v.capturedAt,start)>1800000||!Array.isArray(v.records)||v.records.length>4000)continue;
  groups.push(v.records.filter(r=>r?.sport===sport&&typeof r.ticker==='string'&&/^[A-Z0-9.-]{1,150}$/.test(r.ticker)&&age(r.fetchedAt||v.capturedAt,start)<=1800000).sort((a,b)=>(Date.parse(a.occurrenceAt)||Infinity)-(Date.parse(b.occurrenceAt)||Infinity)).slice(0,50));
 }
 for(let index=0;index<50&&tickers.size<50;index++)for(const group of groups){if(tickers.size>=50)break;if(group[index])tickers.add(group[index].ticker);}
 if(!tickers.size)return {ok:false,code:'NO_FRESH_KALSHI_TICKERS'};
 const signed=await env.FBIS_JOB_FETCH('https://fbis-myz.pages.dev/api/kalshi-market-stream-sign',{
  method:'POST',headers:{'x-fbis-kalshi-relay-token':env.FBIS_KALSHI_RELAY_TOKEN}});
 if(!signed.ok)throw Error('KALSHI_STREAM_SIGNER_HTTP_'+signed.status);
 const b=await signed.json(),headers=b.headers,stamp=Number(headers?.['KALSHI-ACCESS-TIMESTAMP']);
 if(!b.ok||b.path!=='/trade-api/ws/v2'||!Number.isSafeInteger(stamp)||Math.abs(now()-stamp)>10000||
   typeof headers?.['KALSHI-ACCESS-KEY']!=='string'||typeof headers?.['KALSHI-ACCESS-SIGNATURE']!=='string')throw Error('INVALID_KALSHI_STREAM_SIGNATURE');
 lease.spend({requests:1,doDurationMs:30000});
 const response=await fetchImpl('https://external-api-ws.kalshi.com/trade-api/ws/v2',{
  method:'GET',headers:{Upgrade:'websocket',...headers},redirect:'manual',signal:AbortSignal.timeout(10000)});
 const socket=response.webSocket;
 if(response.status!==101||!socket){try{socket?.close(1000,'handshake failed');}catch{}await response.body?.cancel();throw Error('KALSHI_WS_HANDSHAKE_'+response.status);}
 let count=0,reason='SESSION_DEADLINE',closed=false,timer,finish;const quotes=new Map(),done=new Promise(r=>{finish=r;});
 const close=why=>{if(closed)return;closed=true;reason=why;clearTimer(timer);try{socket.close(1000,'bounded-market-read');}catch{}finish();};
 const deadline=Math.min(start+20000,lease.expiresAtMs-1000),enc=new TextEncoder();
 const receive=event=>{if(closed)return;try{
  lease.live();if(now()>=deadline){close('SESSION_DEADLINE');return;}
  if(typeof event.data!=='string'||enc.encode(event.data).byteLength>65536)throw Error('INVALID_FRAME');
  lease.spend({wsMessages:1,wsBytes:enc.encode(event.data).byteLength});count++;
  const m=JSON.parse(event.data);if(m.type==='error'){close('PROVIDER_SUBSCRIPTION_ERROR');return;}
  if(m.type==='ticker'&&tickers.has(m.msg?.market_ticker)){
   const raw=m.msg,price=v=>{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>0&&n<1?n:null;};
   quotes.set(raw.market_ticker,{ticker:raw.market_ticker,yesBid:price(raw.yes_bid_dollars),yesAsk:price(raw.yes_ask_dollars),receivedAt:new Date(now()).toISOString(),sourceObservedAt:null});
  }
 }catch{close('MESSAGE_OR_EXECUTION_LIMIT');}};
 try{
  socket.addEventListener('message',receive);socket.addEventListener('close',()=>close('PROVIDER_CLOSED'));socket.addEventListener('error',()=>close('PROVIDER_ERROR'));
  timer=setTimer(()=>close('SESSION_DEADLINE'),Math.max(1,deadline-now()));socket.accept();
  const subscription=JSON.stringify({id:1,cmd:'subscribe',params:{channels:['ticker'],market_tickers:[...tickers]}});
  lease.spend({wsSends:1,wsSendBytes:enc.encode(subscription).byteLength});socket.send(subscription);await done;
 }finally{close('STOPPED');socket.removeEventListener('message',receive);}
 lease.live();
 const snapshot={version:1,source:'Kalshi WebSocket',capturedAt:new Date(now()).toISOString(),messages:count,quotes:[...quotes.values()],subscribed:tickers.size,stopReason:reason,continuous:false,readOnly:true,canAuthorizeWager:false};
 await env.ARCHIVE.put(KALSHI_STREAM_KEY,JSON.stringify(snapshot));
 return {ok:true,messages:count,quotes:quotes.size,subscribed:tickers.size,stopReason:reason};
}
