import {polymarketUsSubscribe,parsePolymarketUsLite,parsePolymarketUsTrade} from '../../functions/lib/polymarketUsSignedWs.js';
export const STREAM_ROSTER_KEY='market-sources/polymarket-us/stream-roster/current-v2.json';
export const STREAM_SNAPSHOT_KEY='market-sources/polymarket-us/bounded/latest-v1.json';
export const STREAM_STATUS_KEY='market-sources/polymarket-us/bounded/status-v1.json';
export const STREAM_SESSION_MS=20000;
const SPORTS=new Set(['nfl','cfb','cbb','nba','wnba','mlb','nhl','soccer','tennis','npb','kbo']);
const UPSTREAM='https://api.polymarket.us/v1/ws/markets';
const BROKER='https://fbis-myz.pages.dev/api/polymarket-stream-sign';
const encoder=new TextEncoder();
export function validateStreamRoster(value,now=Date.now()){
 const at=Date.parse(value?.capturedAt),until=Date.parse(value?.expiresAt);
 if(value?.version!==2||value.source!=='Polymarket US'||!Number.isFinite(at)||at>now||now-at>900000||!Number.isFinite(until)||until<=now||until>at+900000||!Array.isArray(value.roster)||!value.roster.length||value.roster.length>50)throw Error('INVALID_OR_STALE_STREAM_ROSTER');
 const seen=new Set();
 return value.roster.map(row=>{
  const slug=row?.source_market_id,start=Date.parse(row?.event_start_time),collected=Date.parse(row?.collected_at);
  if(!SPORTS.has(row?.sport)||typeof slug!=='string'||!/^[a-z0-9-]{1,160}$/i.test(slug)||seen.has(slug)||typeof row.canonical_event_id!=='string'||!row.canonical_event_id.length||row.canonical_event_id.length>160||!['moneyline','spread','total'].includes(row.market_family)||!Number.isFinite(start)||start<now-48*3600000||start>now+72*3600000||!Number.isFinite(collected)||collected>now||now-collected>900000)throw Error('INVALID_STREAM_ROSTER_ROW');
  seen.add(slug);return {sport:row.sport,source_market_id:slug,canonical_event_id:row.canonical_event_id,market_family:row.market_family,event_start_time:new Date(start).toISOString(),collected_at:new Date(collected).toISOString()};
 });
}
// Batch producers supply already matched contracts; no provider calls or SQL.
// Fair selection prevents a large single-sport slate filling every slot.
export function buildStreamRosterManifest(candidates,{now=Date.now()}={}){
 if(!Array.isArray(candidates)||!candidates.length||candidates.length>1000)throw Error('BOUNDED_ROSTER_INPUT_REQUIRED');
 const rows=new Map();
 for(const candidate of candidates){
  const [row]=validateStreamRoster({version:2,source:'Polymarket US',capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+900000).toISOString(),roster:[candidate]},now);
  const prior=rows.get(row.source_market_id);
  if(prior&&(prior.sport!==row.sport||prior.canonical_event_id!==row.canonical_event_id||prior.market_family!==row.market_family))throw Error('CONFLICTING_STREAM_IDENTITY');
  if(!prior||row.collected_at>prior.collected_at)rows.set(row.source_market_id,row);
 }
 const groups=new Map([...SPORTS].map(s=>[s,[...rows.values()].filter(r=>r.sport===s).sort((a,b)=>a.event_start_time.localeCompare(b.event_start_time)||a.source_market_id.localeCompare(b.source_market_id))]));
 const roster=[];let offset=0;
 while(roster.length<Math.min(50,rows.size)){
  for(const sport of SPORTS){if(roster.length>=50)break;const row=groups.get(sport)[offset];if(row)roster.push(row);}
  offset++;
 }
 return {version:2,source:'Polymarket US',capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+900000).toISOString(),roster,coverage:Object.fromEntries([...groups].map(([sport,list])=>[sport,{eligible:list.length,selected:roster.filter(r=>r.sport===sport).length,uncovered:list.length-roster.filter(r=>r.sport===sport).length}])),complete:rows.size===roster.length,canQualify:false,canAuthorizeWager:false};
}
export async function runBoundedStream(env,lease,{fetchImpl=fetch,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 // No archive listing, D1, historical replay, automatic reconnect or model writes.
 const startedAt=now(),deadline=Math.min(startedAt+STREAM_SESSION_MS,lease.expiresAtMs-1000);
 if(deadline<=startedAt)throw Error('INSUFFICIENT_STREAM_LEASE');
 lease.spend({doDurationMs:30000});
 const raw=await env.ARCHIVE.get(STREAM_ROSTER_KEY);
 if(!raw)throw Error('STREAM_ROSTER_MISSING');
 const roster=validateStreamRoster(await raw.json(),now());
 if(typeof env.FBIS_STREAM_PROXY_TOKEN!=='string'||env.FBIS_STREAM_PROXY_TOKEN.length<40)throw Error('STREAM_SIGNER_NOT_CONFIGURED');
 const broker=await env.FBIS_JOB_FETCH(BROKER,{method:'POST',headers:{'x-fbis-stream-token':env.FBIS_STREAM_PROXY_TOKEN}});
 if(!broker.ok)throw Error('STREAM_SIGNER_UNAVAILABLE');
 const signed=await broker.json(),stamp=Number(signed.headers?.['X-PM-Timestamp']);
 if(signed.ok!==true||signed.path!=='/v1/ws/markets'||!Number.isSafeInteger(stamp)||Math.abs(now()-stamp)>10000||!/^[-0-9a-f]{36}$/i.test(signed.headers?.['X-PM-Access-Key']||'')||!/^[A-Za-z0-9+/]{86}==$/.test(signed.headers?.['X-PM-Signature']||''))throw Error('INVALID_STREAM_SIGNATURE');
 lease.live();if(now()>=deadline)throw Error('STREAM_DEADLINE');
 lease.spend({requests:1});
 const headers={Upgrade:'websocket'};for(const k of ['X-PM-Access-Key','X-PM-Timestamp','X-PM-Signature'])headers[k]=signed.headers[k];
 const response=await fetchImpl(UPSTREAM,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-now())))});
 const socket=response.webSocket;
 if(response.status!==101||!socket){try{socket?.close(1000,'invalid-handshake');}catch{}await response.body?.cancel();throw Error('STREAM_HANDSHAKE_REJECTED');}
 const bySlug=new Map(roster.map(row=>[row.source_market_id,row])),quotes=new Map(),trades=[];
 let stopReason='SESSION_COMPLETE',messages=0,closed=false,timer,finish;
 const done=new Promise(resolve=>{finish=resolve;});
 const close=reason=>{if(closed)return;closed=true;stopReason=reason;clearTimer(timer);try{socket.close(1000,'bounded-session-ended');}catch{}finish();};
 const send=value=>{lease.live();if(now()>=deadline)throw Error('STREAM_DEADLINE');const message=JSON.stringify(value);lease.spend({wsSends:1,wsSendBytes:encoder.encode(message).byteLength});socket.send(message);};
 const receive=event=>{
  if(closed)return;
  try{
   lease.live();if(now()>=deadline)throw Error('STREAM_DEADLINE');
   if(typeof event.data!=='string'||event.data.length>65536)throw Error('STREAM_FRAME_SIZE_OR_TYPE');
   const size=encoder.encode(event.data).byteLength;if(size>65536)throw Error('STREAM_FRAME_SIZE_OR_TYPE');
   lease.spend({wsMessages:1,wsBytes:size});messages++;
   const value=JSON.parse(event.data);
   if(value.error){close('PROVIDER_SUBSCRIPTION_ERROR');return;}
   if(value.heartbeat){send({heartbeat:{}});return;}
   const quote=parsePolymarketUsLite(value),trade=parsePolymarketUsTrade(value);
   if(quote&&bySlug.has(quote.marketSlug))quotes.set(quote.marketSlug,{...quote,receivedAt:new Date(now()).toISOString(),quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE'});
   if(trade&&bySlug.has(trade.marketSlug))trades.push({...trade,receivedAt:new Date(now()).toISOString()});
  }catch{close('MESSAGE_OR_EXECUTION_LIMIT');}
 };
 try{
  lease.live();if(now()>=deadline)throw Error('STREAM_DEADLINE');
  socket.addEventListener('message',receive);
  socket.addEventListener('close',()=>close('PROVIDER_CLOSED'));
  socket.addEventListener('error',()=>close('PROVIDER_ERROR'));
  timer=setTimer(()=>close('SESSION_DEADLINE'),Math.max(1,deadline-now()));
  socket.accept();send(polymarketUsSubscribe(roster.map(r=>r.source_market_id),'fbis-bounded-book',{fullBook:true}));
  await done;
 }finally{close('SESSION_STOPPED');socket.removeEventListener('message',receive);}
 lease.live();
 const snapshot={version:1,source:'Polymarket US',scope:'BOUNDED_RESEARCH_CAPTURE',startedAt:new Date(startedAt).toISOString(),capturedAt:new Date(now()).toISOString(),stopReason,roster,quotes:[...quotes.values()],trades,messages,complete:false,continuous:false,canQualify:false,canAuthorizeWager:false,executionEligible:false};
 // Publish after the socket is closed. A failed/expired lease cannot queue later
 // writes, reconnects, archive history, or fallback writes to PRIMARY.
 await env.ARCHIVE.put(STREAM_SNAPSHOT_KEY,JSON.stringify(snapshot));
 const status={version:1,source:snapshot.source,scope:snapshot.scope,capturedAt:snapshot.capturedAt,stopReason,messages,subscribed:roster.length,quotes:quotes.size,trades:trades.length,continuous:false,canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(STREAM_STATUS_KEY,JSON.stringify(status));
 return status;
}
