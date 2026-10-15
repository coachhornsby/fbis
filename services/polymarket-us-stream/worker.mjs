import {DurableObject} from "cloudflare:workers";
import {polymarketUsSubscribe,parsePolymarketUsLite}
  from "../../functions/lib/polymarketUsSignedWs.js";
import {persistNormalizedMarketBatch} from "../../functions/lib/marketObservationLedger.js";
import {fairMarketSelection,shouldSaveBbo,liveBboOffer,parseStreamControl,streamIsHealthy,fetchStreamUpgrade,streamContractRosterWindow} from "./core.mjs";

const UPSTREAM="https://api.polymarket.us/v1/ws/markets";
const MAX_MARKETS=48, MAX_BATCH=40, MAX_QUEUE=200;
const RECONNECT_MS=60000, ROTATE_MS=9*60000, FLUSH_MS=5000;
const toJSON=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});

export class PolymarketMarketStream extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.socket=null;this.subscribed=new Map();this.queue=new Map();
    this.lastSaved=new Map();this.connectedAt=0;this.reconnectCount=0;
    this.received=0;this.parsed=0;this.inserted=0;
    this.lastError=null;this.lastConnectAttempt=0;this.flushTimer=null;
    this.running=false;this.lastMessageAt=0;this.lastHeartbeatAt=0;this.heartbeats=0;this.lastClose=null;
  }
  status(){
    return {connected:this.socket?.readyState===WebSocket.OPEN,
      connectedAt:this.connectedAt?new Date(this.connectedAt).toISOString():null,
      subscriptions:this.subscribed.size,queued:this.queue.size,
      operational:!this.lastError&&streamIsHealthy({connected:this.socket?.readyState===WebSocket.OPEN,lastMessageAt:this.lastMessageAt}),
      lastMessageAt:this.lastMessageAt?new Date(this.lastMessageAt).toISOString():null,
      lastHeartbeatAt:this.lastHeartbeatAt?new Date(this.lastHeartbeatAt).toISOString():null,
      heartbeats:this.heartbeats,lastClose:this.lastClose,
      received:this.received,parsed:this.parsed,inserted:this.inserted,
      reconnects:this.reconnectCount,lastError:this.lastError,
      signerProxyConfigured:Boolean(this.env.FBIS_STREAM_PROXY_TOKEN),
      lastConnectAttemptAt:this.lastConnectAttempt?new Date(this.lastConnectAttempt).toISOString():null,
      readOnly:true,canAuthorizeWager:false};
  }
  async fetch(req){
    const pathname=new URL(req.url).pathname;
    if(pathname==="/status")return toJSON(this.status());
    if(pathname!=="/start"||req.method!=="POST")return toJSON({ok:false},405);
    if(!this.env.FBIS_STREAM_PROXY_TOKEN){
      this.lastError="stream-signer-not-configured";
      return toJSON({ok:false,reason:this.lastError,...this.status()},503);
    }
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN)await this.connect();
    else await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
    return toJSON({ok:!!this.socket, ...this.status()});
  }
  async candidates(){
    const now=Date.now();
    const {since:rosterSince,freshSince}=streamContractRosterWindow(now);
    const from=new Date(now-4*3600000).toISOString();
    const until=new Date(now+48*3600000).toISOString();
    const q=await this.env.DB.prepare(`WITH recent AS (
       SELECT sport,league,canonical_event_id,provider_event_id,
        event_start_time,home_team,away_team,
        CASE WHEN sport='soccer' AND json_extract(raw_payload_json,'$.providerMarket.sportsMarketType') LIKE '%full_time_winner%' THEN 'moneyline' ELSE market_family END market_family,
        CASE WHEN sport='soccer' AND json_extract(raw_payload_json,'$.providerMarket.sportsMarketType') LIKE '%full_time_winner%' THEN COALESCE(json_extract(raw_payload_json,'$.providerSide.team.name'),REPLACE(json_extract(raw_payload_json,'$.providerMarket.title'),' (Reg. Time)','')) ELSE side END side,line,
        CASE WHEN json_extract(raw_payload_json,'$.providerMarket.sportsMarketType') LIKE '%first_half%' THEN 'first_half' WHEN json_extract(raw_payload_json,'$.providerMarket.sportsMarketType') LIKE '%second_half%' THEN 'second_half' WHEN json_extract(raw_payload_json,'$.providerMarket.sportsMarketType') LIKE '%full_time%' OR json_extract(raw_payload_json,'$.providerMarket.sportsMarketType') LIKE '%full_game%' THEN 'full_game' ELSE period END period,
        source_market_id,source_outcome_id,collected_at,raw_payload_json,
        ROW_NUMBER() OVER(PARTITION BY source_market_id ORDER BY collected_at DESC) rn
       FROM normalized_market_observations
       WHERE source='Polymarket US' AND source_market_id IS NOT NULL
       AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.contractLong')=1
       AND collected_at>=?1 AND event_start_time BETWEEN ?2 AND ?3
      ), balanced AS (
       SELECT *,ROW_NUMBER() OVER(PARTITION BY sport ORDER BY
        CASE WHEN julianday(event_start_time)>=julianday('now') THEN 0 ELSE 1 END,
        CASE WHEN json_extract(raw_payload_json,'$.marketState') IN ('MARKET_STATUS_OPEN','MARKET_STATE_OPEN') THEN 0 ELSE 1 END,
        CASE WHEN collected_at>=?4 THEN 0 ELSE 1 END,
        CASE WHEN period='full_game' THEN 0 ELSE 1 END,
        CASE WHEN market_family='moneyline' THEN 0 ELSE 1 END,
        CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END,
        collected_at DESC) sport_rank
       FROM recent WHERE rn=1
      ) SELECT * FROM balanced WHERE sport_rank<=6
       ORDER BY sport,sport_rank LIMIT 66`)
       .bind(rosterSince,from,until,freshSince).all();
    return fairMarketSelection(q.results||[],{perSport:6,maxMarkets:MAX_MARKETS});
  }
  async connect(){
    if(this.running)return;
    this.running=true;this.lastConnectAttempt=Date.now();
    try{
      const candidates=await this.candidates();
      if(!candidates.length){
        this.lastError="no-active-markets";
        await this.ctx.storage.setAlarm(Date.now()+2*RECONNECT_MS);
        return;
      }
      // Fresh market-only signature is produced by Pages. The Polymarket
      // private key stays in the original encrypted Pages secret store.
      const brokerResponse=await fetch("https://fbis-myz.pages.dev/api/polymarket-stream-sign",{
        method:"POST",
        headers:{"x-fbis-stream-token":this.env.FBIS_STREAM_PROXY_TOKEN},
        signal:AbortSignal.timeout(12000)
      });
      if(!brokerResponse.ok){
        this.lastError="market-signature-broker-"+brokerResponse.status;
        await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
        return;
      }
      const signed=await brokerResponse.json();
      if(signed.ok!==true||signed.path!=="/v1/ws/markets"||
         !signed.headers?.["X-PM-Access-Key"]||!signed.headers?.["X-PM-Signature"]){
        this.lastError="invalid-broker-signature";
        await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
        return;
      }
      const signedAt=Number(signed.headers["X-PM-Timestamp"]);
      if(!Number.isFinite(signedAt)||Math.abs(Date.now()-signedAt)>15000){
        this.lastError="stale-broker-signature";
        await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
        return;
      }
      const headers=signed.headers;
      const r=await fetchStreamUpgrade(UPSTREAM,{headers:{...headers,Upgrade:"websocket"}});
      if(r.status!==101||!r.webSocket){
        this.lastError="upstream-handshake-"+r.status;
        await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
        return;
      }
      const old=this.socket;
      if(old){try{old.close(1000,"refresh")}catch{}}
      this.socket=r.webSocket;
      this.subscribed=new Map(candidates.map(c=>[c.source_market_id,c]));
      this.socket.accept();
      const socket=this.socket;
      socket.addEventListener("message",e=>{if(this.socket===socket)this.onMessage(e)});
      socket.addEventListener("close",event=>{
        if(this.socket===socket){this.socket=null;
          this.lastClose={at:new Date().toISOString(),code:event.code,reason:String(event.reason||"" ).slice(0,200)};
          this.lastError="upstream-socket-closed-"+event.code;
          this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS).catch(()=>{});}
      });
      socket.addEventListener("error",()=>{
        if(this.socket===socket){this.socket=null;this.lastError="upstream-socket-error";
          this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS).catch(()=>{});}
      });
      socket.send(JSON.stringify(polymarketUsSubscribe(
        [...this.subscribed.keys()],"fbis-always-on-market-book",{fullBook:true})));
      this.connectedAt=Date.now();this.lastMessageAt=0;this.lastHeartbeatAt=0;this.reconnectCount++;
      this.lastError=null;
      await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
    }catch{
      this.lastError="connection-or-provider-error";
      await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
    }finally{this.running=false}
  }
  onMessage(evt){
    this.received++;this.lastMessageAt=Date.now();
    const control=parseStreamControl(evt.data);
    if(control?.type==="heartbeat"){
      this.lastHeartbeatAt=this.lastMessageAt;this.heartbeats++;
      try{this.socket?.send(JSON.stringify({heartbeat:{}}))}catch{this.lastError="heartbeat-send-failed"}
      return;
    }
    if(control?.type==="error"){this.lastError="upstream-subscription-error";
      try{this.socket?.close(1000,"subscription rejected")}catch{}
      this.socket=null;this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS).catch(()=>{});return;}
    const tick=parsePolymarketUsLite(evt.data);
    if(!tick||!this.subscribed.has(tick.marketSlug))return;
    this.parsed++;
    const entry={...tick,timeMs:Date.now(),at:new Date().toISOString()};
    if(!shouldSaveBbo(entry,this.lastSaved.get(tick.marketSlug)))return;
    // Collapse high-frequency ticks by contract, not by first-come-wins.
    if(this.queue.size>=MAX_QUEUE&&!this.queue.has(tick.marketSlug))
      this.queue.delete(this.queue.keys().next().value);
    this.queue.set(tick.marketSlug,entry);
    if(!this.flushTimer){
      this.flushTimer=setTimeout(()=>{
        this.flushTimer=null;
        this.ctx.waitUntil(this.flush());
      },FLUSH_MS);
    }
  }
  async flush(){
    if(!this.queue.size)return;
    const ticks=[...this.queue.values()].slice(0,MAX_BATCH);
    for(const tick of ticks)this.queue.delete(tick.marketSlug);
    const offers=ticks.map(t=>liveBboOffer(t,this.subscribed.get(t.marketSlug))).filter(Boolean);
    try{
      const r=await persistNormalizedMarketBatch(this.env.DB,offers,{
        snapshotType:"CURRENT",collectedAt:new Date().toISOString(),modelProbability:null
      });
      this.inserted+=r.inserted;
      for(const t of ticks)this.lastSaved.set(t.marketSlug,t);
    }catch{
      this.lastError="d1-bbo-persist-error";
      // No fabrication and no optimistic D1 success count.
      for(const t of ticks)if(this.queue.size<MAX_QUEUE)this.queue.set(t.marketSlug,t);
    }
    if(this.queue.size&&!this.flushTimer){
      this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.ctx.waitUntil(this.flush())},FLUSH_MS);
    }
  }
  async alarm(){
    await this.flush();
    // Rotate before Cloudflare outbound keep-alive's 15-minute instance limit.
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN||
        Date.now()-this.connectedAt>=ROTATE_MS||
        Date.now()-(this.lastMessageAt||this.connectedAt)>2*RECONNECT_MS){
      try{this.socket?.close(1000,"9-minute stream rotation")}catch{}
      this.socket=null;
      await this.connect();
    }else await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
  }
}

export default {
  async scheduled(_event,env,ctx){
    // Safe periodic reactivation after worker restarts/deployment. One DO
    // instance covers fair samples from all FBIS sports that list contracts.
    const id=env.PM_STREAM.idFromName("active-sports-fbis");
    const stub=env.PM_STREAM.get(id);
    ctx.waitUntil(stub.fetch("https://internal/start",{method:"POST"}).then(async response=>{
      if(!response.ok) console.warn("POLYMARKET_MARKET_STREAM_RESTART_FAILED",response.status);
    }).catch(()=>console.warn("POLYMARKET_MARKET_STREAM_RESTART_UNREACHABLE")));
  },
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/start"){
      if(request.method!=="POST")return toJSON({ok:false,error:"method-not-allowed"},405);
      if(!env.FBIS_STREAM_PROXY_TOKEN||request.headers.get('x-fbis-stream-token')!==env.FBIS_STREAM_PROXY_TOKEN)return toJSON({ok:false,error:"unauthorized"},403);
      const stub=env.PM_STREAM.get(env.PM_STREAM.idFromName("active-sports-fbis"));
      return stub.fetch("https://internal/start",{method:"POST"});
    }
    if(u.pathname!=="/health")return toJSON({ok:false,error:"not-found"},404);
    const stub=env.PM_STREAM.get(env.PM_STREAM.idFromName("active-sports-fbis"));
    const r=await stub.fetch("https://internal/status");
    const status=await r.json();
    return toJSON({ok:true,source:"Polymarket US signed persistent market collector",
      mode:"DURABLE_OBJECT_RECONNECTING",...status,
      workerSignerProxyConfigured:Boolean(env.FBIS_STREAM_PROXY_TOKEN),
      privateAccountAccess:false});
  }
};
