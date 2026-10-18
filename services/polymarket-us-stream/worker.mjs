import {DurableObject} from "cloudflare:workers";
import {polymarketUsSubscribeBatches,parsePolymarketUsLite,parsePolymarketUsTrade}
  from "../../functions/lib/polymarketUsSignedWs.js";
import {persistNormalizedMarketBatch} from "../../functions/lib/marketObservationLedger.js";
import {mirrorPersistentStreamRows} from "./shadow.mjs";
import {persistStreamRecoveryBatch} from "./historyRecovery.mjs";
import {
  manageSubscriptionCapacity,resolveStreamCapacity,STREAM_SPORTS,
  shouldSaveBbo,liveBboOffer,liveBboOffers,parseStreamControl,streamIsHealthy,
  fetchStreamUpgrade,streamContractRosterWindow,
} from "./core.mjs";

const UPSTREAM="https://api.polymarket.us/v1/ws/markets";
const MAX_BATCH=40, MAX_QUEUE=400;
const RECONNECT_MS=60000, ROTATE_MS=9*60000, FLUSH_MS=5000;
const toJSON=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});

export class PolymarketMarketStreamCoverage extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.socket=null;this.sockets=new Map();this.expectedConnections=0;this.subscribed=new Map();this.queue=new Map();
    this.tradeStats=new Map();this.tradeQueue=[];this.tradeArchiveFailures=0;this.tradeDropped=0;
    this.lastSaved=new Map();this.connectedAt=0;this.reconnectCount=0;
    this.received=0;this.parsed=0;this.inserted=0;this.spilled=0;this.historyInserted=0;
    this.lastError=null;this.lastConnectAttempt=0;this.flushTimer=null;
    this.running=false;this.lastCandidateDiagnostics=null;this.lastMessageAt=0;this.lastHeartbeatAt=0;this.heartbeats=0;this.lastClose=null;
    this.shadowPendingIds=[];this.shadowLoaded=false;this.shadowVerified=0;this.shadowWritten=0;
    this.shadowFailed=0;this.shadowGap=0;this.lastShadowError=null;this.shadowDrainPromise=null;
    this.persistenceStatus="UNVERIFIED";this.lastSpillKey=null;this.lastSpillAt=null;
    this.historyLastError=null;
    this.codeVersion="sport-pinned-partitions-tennis-parity-history-recovery-20261018";
  }
  isCanonicalOwner(){
    if(!this.ctx.id?.toString||!this.env.PM_STREAM?.idFromName)return true;
    return this.ctx.id.toString()===this.env.PM_STREAM.idFromName('active-sports-fbis-v3').toString();
  }
  closeSockets(reason){
    const sockets=new Set([...this.sockets.keys(),this.socket].filter(Boolean));
    this.sockets.clear();this.socket=null;this.subscribed.clear();
    for(const socket of sockets){try{socket.close(1000,reason)}catch{}}
  }
  async retireLegacyOwner(){
    this.closeSockets('legacy-owner-retired');
    if(this.flushTimer)clearTimeout(this.flushTimer);this.flushTimer=null;
    await this.ctx.storage.deleteAlarm();this.retiredOwner=true;this.lastError='LEGACY_OWNER_RETIRED';
  }
  capacityPlan(){
    return {...resolveStreamCapacity(this.env||{}),coverAllEligible:this.env.STREAM_COVER_ALL_ELIGIBLE==='enabled'};
  }
  status(){
    const capacity=this.lastCandidateDiagnostics?.capacity||this.capacityPlan();
    const coverage=this.lastCandidateDiagnostics?.bySport||null;
    const active=[...this.sockets.keys()].filter(s=>s.readyState===WebSocket.OPEN);
    const connected=this.expectedConnections>0?active.length===this.expectedConnections:this.socket?.readyState===WebSocket.OPEN;
    const streamHealthy=streamIsHealthy({connected,lastMessageAt:this.lastMessageAt});
    // Primary D1 inserts only count as HEALTHY persistence. R2 spill is recovery
    // evidence (DEGRADED), never silent success or a second write owner.
    return {connected,retiredOwner:!this.isCanonicalOwner(),initializing:this.running,diagnosticsVersion:2,lastSubscriptionError:this.lastSubscriptionError||null,
      connectedAt:this.connectedAt?new Date(this.connectedAt).toISOString():null,
      subscriptions:this.subscribed.size,subscribedMarketIds:[...this.subscribed.keys()],queued:this.queue.size,
      candidateDiagnostics:this.lastCandidateDiagnostics,
      capacity,
      desiredConnections:this.expectedConnections,
      activeConnections:active.length||(connected?1:0),
      connectionLimitContracts:50,
      connectionPartitionMode:"sport-pinned",
      sportCoverage:coverage,
      uncoveredCount:Math.max(Number(this.lastCandidateDiagnostics?.uncoveredCount||0),Number(this.lastCandidateDiagnostics?.eligibleCount||0)-this.subscribed.size),
      streamHealthy,
      persistenceStatus:this.persistenceStatus,
      // Stream is operational when connected and fresh. Persistence DEGRADED/UNAVAILABLE
      // (D1 full) must not be hidden — those states clear operational until inserts recover.
      // UNVERIFIED means no flush yet (bootstrap heartbeat / subscribe) and is allowed.
      operational:streamHealthy&&!this.lastError&&
        (this.persistenceStatus==="HEALTHY"||this.persistenceStatus==="UNVERIFIED"),
      lastMessageAt:this.lastMessageAt?new Date(this.lastMessageAt).toISOString():null,
      lastHeartbeatAt:this.lastHeartbeatAt?new Date(this.lastHeartbeatAt).toISOString():null,
      heartbeats:this.heartbeats,lastClose:this.lastClose,
      received:this.received,parsed:this.parsed,tradeContracts:this.tradeStats.size,tradeQueued:this.tradeQueue.length,tradeArchiveFailures:this.tradeArchiveFailures,tradeDropped:this.tradeDropped,inserted:this.inserted,spilled:this.spilled,
      historyInserted:this.historyInserted,
      historyLastError:this.historyLastError,
      lastSpillKey:this.lastSpillKey,lastSpillAt:this.lastSpillAt,
      shadow:{enabled:this.env.MARKET_HISTORY_SHADOW_WS==="enabled",
       loaded:this.shadowLoaded,pending:this.shadowPendingIds.length,
       verified:this.shadowVerified,written:this.shadowWritten,failed:this.shadowFailed,
       gap:this.shadowGap,lastError:this.lastShadowError,
       sourceIsAuthoritative:true},
      reconnects:this.reconnectCount,lastError:this.lastError,
      signerProxyConfigured:Boolean(this.env.FBIS_STREAM_PROXY_TOKEN),
      lastConnectAttemptAt:this.lastConnectAttempt?new Date(this.lastConnectAttempt).toISOString():null,
      architecture:"single-do-dynamic-capacity",
      fixedCapRetired:true,
      codeVersion:this.codeVersion,
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
    // Allow a paced connection already in progress to finish before rotating it.
    const deadline=Date.now()+60000;while(this.running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));
    if(this.running)return toJSON({ok:false,reason:'CONNECT_IN_PROGRESS',...this.status()},409);
    // Always rotate the socket on /start so post-deploy code (capacity +
    // recovery writes) replaces any WebSocket-pinned prior isolate.
    this.closeSockets("operator-forced-restart");
    await this.connect();
    return toJSON({ok:this.status().connected===true, ...this.status()});
  }
  async archiveCandidates({rosterSince,from,until}){
    const empty={assigned:[],partitions:[]};
    if(!this.env.ARCHIVE?.list)return empty;
    const prefix="market-sources/polymarket-us/stream-roster/";
    let listing,cursor;const keys=[];
    do{listing=await this.env.ARCHIVE.list({prefix,limit:500,...(cursor?{cursor}:{})});keys.push(...(listing.objects||[]).map(x=>x.key));if(listing.truncated&&(!listing.cursor||listing.cursor===cursor))throw Error('ROSTER_CURSOR_INVALID');cursor=listing.cursor;}while(listing.truncated);
    const all=[];
    for(const key of keys){
      const object=await this.env.ARCHIVE.get(key);
      if(!object)continue;
      const page=await object.json();
      if(page.version!==1||page.source!=="Polymarket US"||
        !Number.isFinite(Date.parse(page.capturedAt))||page.capturedAt<rosterSince||
        !Array.isArray(page.roster))continue;
      for(const item of page.roster){
        if(!item?.canonical_event_id||!item?.source_market_id||
          !/^[a-z0-9-]{1,160}$/i.test(item.source_market_id)||
          !["moneyline","spread","total"].includes(item.market_family)||
          typeof item.event_start_time!=="string"||
          item.event_start_time<from||item.event_start_time>until)continue;
        all.push(item);
      }
    }
    if(!all.length)return empty;
    // Archived contract metadata is not evidence of an independent projection.
    // Verify canonical event and pre-event model timing in primary D1 BEFORE WS subscription.
    const events=[...new Map(all.map(x=>[x.sport+"|"+x.canonical_event_id,
      {sport:x.sport,canonical_event_id:String(x.canonical_event_id),
       event_start_time:x.event_start_time}])).values()];
    const query=`WITH roster AS (
      SELECT json_extract(value,'$.sport') sport,
        json_extract(value,'$.canonical_event_id') canonical_event_id,
        json_extract(value,'$.event_start_time') event_start_time
      FROM json_each(?1)
    ) SELECT DISTINCT sport,canonical_event_id FROM roster r WHERE
      EXISTS (SELECT 1 FROM prediction_snapshots ps
        WHERE ps.game_id=r.canonical_event_id AND ps.sport=r.sport
          AND ps.model_version IS NOT NULL
          AND COALESCE(ps.projection_kind,'FBIS')<>'UNAVAILABLE'
          AND (ps.proj_total IS NOT NULL OR
            (ps.proj_home IS NOT NULL AND ps.proj_away IS NOT NULL)
            OR ps.p_home_final BETWEEN 0 AND 1)
          AND julianday(ps.frozen_at)<=julianday('now')
          AND julianday(ps.frozen_at)<julianday(r.event_start_time))
      OR EXISTS (SELECT 1 FROM tennis_v2_research_decisions td
        WHERE r.sport='tennis' AND td.canonical_event_id=r.canonical_event_id
          AND td.pure_p1 BETWEEN 0 AND 1
          AND julianday(td.decision_timestamp)<=julianday('now')
          AND julianday(td.decision_timestamp)<julianday(r.event_start_time))
      OR EXISTS (SELECT 1 FROM published_projections pp
        WHERE pp.game_id=r.canonical_event_id AND pp.sport=r.sport
          AND julianday(pp.published_at)<=julianday('now')
          AND julianday(pp.published_at)<julianday(r.event_start_time)
          AND json_valid(pp.payload_json)
          AND json_extract(pp.payload_json,'$.model.independent')=1)`;
    const result=await this.env.DB.prepare(query).bind(JSON.stringify(events)).all();
    const permitted=new Set((result.results||[]).map(x=>x.sport+"|"+x.canonical_event_id));
    const byMarket=new Map();
    for(const item of all){
      if(!permitted.has(item.sport+"|"+item.canonical_event_id))continue;
      const old=byMarket.get(item.source_market_id);
      if(!old||item.collected_at>old.collected_at)byMarket.set(item.source_market_id,item);
    }
    const plan=manageSubscriptionCapacity([...byMarket.values()],this.capacityPlan());
    this.lastCandidateDiagnostics={at:new Date().toISOString(),
      source:"existing-r2-rest-roster",archivedMarkets:all.length,
      verifiedEvents:permitted.size,eligibleCount:plan.eligibleCount,
      selected:plan.assignedCount,uncoveredCount:plan.uncoveredCount,
      bySport:plan.bySport,capacity:plan.capacity,
      partitions:plan.partitions.map(p=>({id:p.id,sport:p.sport,size:p.size})),
      archiveListingComplete:listing.truncated!==true,
      reason:plan.assignedCount?"ARCHIVE_ROSTER_VERIFIED":"NO_ELIGIBLE_ARCHIVE_CONTRACTS"};
    return {assigned:plan.assigned,partitions:plan.partitions};
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
        source_market_id,source_outcome_id,collected_at,
        json_extract(raw_payload_json,'$.opposite') opposite_json,
        json_extract(raw_payload_json,'$.canonicalSide') canonical_side,
        json_extract(raw_payload_json,'$.providerMarket.feeCoefficient') fee_coefficient,
        json_object('marketState',json_extract(raw_payload_json,'$.marketState')) raw_payload_json,
        ROW_NUMBER() OVER(PARTITION BY source_market_id ORDER BY collected_at DESC,CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END,id DESC) rn
       FROM normalized_market_observations nmo
       WHERE source='Polymarket US' AND source_market_id IS NOT NULL
       AND nmo.canonical_event_id IS NOT NULL
       AND nmo.market_family IN ('moneyline','spread','total')
       -- Do not subscribe to odds without a prior independent model forecast.
       -- These immutable evidence clocks cannot use a later projection.
       AND (
         EXISTS (SELECT 1 FROM prediction_snapshots ps
           WHERE ps.game_id=nmo.canonical_event_id AND ps.sport=nmo.sport
           AND ps.model_version IS NOT NULL
           AND COALESCE(ps.projection_kind,'FBIS')<>'UNAVAILABLE'
           AND (ps.proj_total IS NOT NULL OR
                (ps.proj_home IS NOT NULL AND ps.proj_away IS NOT NULL) OR
                (ps.p_home_final>=0 AND ps.p_home_final<=1))
           AND julianday(ps.frozen_at)<=julianday('now')
           AND julianday(ps.frozen_at)<julianday(nmo.event_start_time))
         OR EXISTS (SELECT 1 FROM tennis_v2_research_decisions td
           WHERE nmo.sport='tennis'
           AND td.canonical_event_id=nmo.canonical_event_id
           AND td.pure_p1 BETWEEN 0 AND 1
           AND julianday(td.decision_timestamp)<=julianday('now')
           AND julianday(td.decision_timestamp)<julianday(nmo.event_start_time))
         OR EXISTS (SELECT 1 FROM published_projections pp
           WHERE pp.game_id=nmo.canonical_event_id AND pp.sport=nmo.sport
           AND julianday(pp.published_at)<=julianday('now')
           AND julianday(pp.published_at)<julianday(nmo.event_start_time)
           AND json_valid(pp.payload_json)
           AND json_extract(pp.payload_json,'$.model.independent')=1)
       )
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
      -- Return the full verified inventory; no per-sport or global sampling cutoff.
      -- Assignment/fairness/capacity live in manageSubscriptionCapacity — not a fixed 48.
      ) SELECT * FROM balanced
       ORDER BY sport,sport_rank`)
       .bind(rosterSince,from,until,freshSince).all();
    const roster=(q.results||[]).map(row=>{let opposite=row.opposite;try{opposite=JSON.parse(row.opposite_json||'null')||opposite;}catch{}return {...row,opposite};});
    const plan=manageSubscriptionCapacity(roster,this.capacityPlan());
    this.lastCandidateDiagnostics={at:new Date().toISOString(),
      selected:plan.assignedCount,eligibleCount:plan.eligibleCount,
      uncoveredCount:plan.uncoveredCount,returnedRows:(q.results||[]).length,
      bySport:plan.bySport,capacity:plan.capacity,source:'primary-d1',
      partitions:plan.partitions.map(p=>({id:p.id,sport:p.sport,size:p.size})),
      rosterSince,freshSince,
      reason:plan.assignedCount?'ELIGIBLE_CONTRACTS':'NO_ELIGIBLE_CONTRACTS'};
    if(plan.assignedCount)return {assigned:plan.assigned,partitions:plan.partitions};
    try{return await this.archiveCandidates({rosterSince,from,until})}
    catch(error){
      this.lastCandidateDiagnostics={...this.lastCandidateDiagnostics,
        archiveFallbackError:"ARCHIVE_ROSTER_UNAVAILABLE"};
      return {assigned:[],partitions:[]};
    }
  }
  async connect(){
    if(!this.isCanonicalOwner()){await this.retireLegacyOwner();return;}
    if(this.running)return;
    this.running=true;this.lastConnectAttempt=Date.now();
    try{
      const plan=await this.candidates();
      const partitions=Array.isArray(plan?.partitions)?plan.partitions:[];
      if(!partitions.length){
        this.lastError="no-active-markets";
        await this.ctx.storage.setAlarm(Date.now()+2*RECONNECT_MS);
        return;
      }
      this.closeSockets("refresh");
      // One socket per sport-pinned partition (≤50 slugs). Empty sports get none.
      // Single DO owner remains active-sports-fbis-v3.
      this.expectedConnections=partitions.length;
      this.tradeStats.clear();this.lastSubscriptionError=null;this.lastError=null;
      this.connectedAt=Date.now();this.lastMessageAt=0;this.lastHeartbeatAt=0;this.reconnectCount++;
      for(const partition of partitions){
        if(this.lastError)break;
        const group=partition.contracts||[];
        // Obtain a fresh signature for every sequential handshake.
        const brokerResponse=await fetch("https://fbis-myz.pages.dev/api/polymarket-stream-sign",{
          method:"POST",headers:{"x-fbis-stream-token":this.env.FBIS_STREAM_PROXY_TOKEN},
          signal:AbortSignal.timeout(12000)});
        if(!brokerResponse.ok)throw Error("market-signature-broker-"+brokerResponse.status);
        const signed=await brokerResponse.json();
        const signedAt=Number(signed.headers?.["X-PM-Timestamp"]);
        if(signed.ok!==true||signed.path!=="/v1/ws/markets"||
          !signed.headers?.["X-PM-Access-Key"]||!signed.headers?.["X-PM-Signature"]||
          !Number.isFinite(signedAt)||Math.abs(Date.now()-signedAt)>15000)throw Error("invalid-broker-signature");
        const r=await fetchStreamUpgrade(UPSTREAM,{headers:{...signed.headers,Upgrade:"websocket"}});
        if(r.status!==101||!r.webSocket)throw Error("upstream-handshake-"+r.status);
        const socket=r.webSocket;
        const state={sport:partition.sport,slugs:partition.marketSlugs||group.map(c=>c.source_market_id),lastMessageAt:Date.now()};
        this.sockets.set(socket,state);this.socket=socket;socket.accept();
        socket.addEventListener("message",e=>{if(this.sockets.has(socket)){state.lastMessageAt=Date.now();this.onMessage(e,socket)}});
        const lost=(reason,event)=>{
          if(!this.sockets.has(socket))return;
          this.sockets.delete(socket);
          for(const slug of state.slugs)this.subscribed.delete(slug);
          this.lastError=reason;
          this.lastClose={at:new Date().toISOString(),code:event?.code||null,reason:String(event?.reason||reason).slice(0,200)};
          this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS).catch(()=>{});
        };
        socket.addEventListener("close",e=>lost("upstream-socket-closed-"+e.code,e));
        socket.addEventListener("error",()=>lost("upstream-socket-error"));
        const frames=polymarketUsSubscribeBatches(state.slugs,"fbis-book-"+partition.sport+"-"+partition.id,{fullBook:true});
        for(const frame of frames){
          if(!this.sockets.has(socket)||socket.readyState!==WebSocket.OPEN||this.lastError)break;
          for(const slug of frame.subscribe.market_slugs)this.subscribed.set(slug,group.find(c=>c.source_market_id===slug));
          socket.send(JSON.stringify(frame));await new Promise(r=>setTimeout(r,250));
          if(!this.sockets.has(socket)||socket.readyState!==WebSocket.OPEN||this.lastError)break;
          socket.send(JSON.stringify({subscribe:{...frame.subscribe,request_id:frame.subscribe.request_id+'-trades',subscription_type:'SUBSCRIPTION_TYPE_TRADE'}}));
          await new Promise(r=>setTimeout(r,250));
        }
      }
      if(this.lastCandidateDiagnostics)this.lastCandidateDiagnostics={...this.lastCandidateDiagnostics,
        actualConnections:this.sockets.size,subscribed:this.subscribed.size};
      await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
    }catch{
      this.lastError="connection-or-provider-error";
      await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
    }finally{this.running=false}
  }
  onMessage(evt,socket=this.socket){
    if(!this.isCanonicalOwner()){this.ctx.waitUntil(this.retireLegacyOwner());return;}
    this.received++;this.lastMessageAt=Date.now();
    const control=parseStreamControl(evt.data);
    if(control?.type==="heartbeat"){
      this.lastHeartbeatAt=this.lastMessageAt;this.heartbeats++;
      try{socket?.send(JSON.stringify({heartbeat:{}}))}catch{this.lastError="heartbeat-send-failed"}
      return;
    }
    if(control?.type==="error"){this.lastError="upstream-subscription-error";
      this.lastSubscriptionError={at:new Date().toISOString(),...control};
      if(this.env.ARCHIVE?.put&&this.ctx.waitUntil)this.ctx.waitUntil(this.env.ARCHIVE.put('market-sources/polymarket-us/coverage/last-subscription-error.json',JSON.stringify(this.lastSubscriptionError)).catch(()=>{}));
      const state=this.sockets.get(socket);this.sockets.delete(socket);
      for(const slug of state?.slugs||[])this.subscribed.delete(slug);
      try{socket?.close(1000,"subscription rejected")}catch{}
      if(this.socket===socket)this.socket=null;this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS).catch(()=>{});return;}
    const trade=parsePolymarketUsTrade(evt.data);
    if(trade&&this.subscribed.has(trade.marketSlug)){
      const stat=this.tradeStats.get(trade.marketSlug)||{count:0,since:new Date().toISOString()};
      stat.count++;this.tradeStats.set(trade.marketSlug,stat);
      if(this.tradeQueue.length<500)this.tradeQueue.push({...trade,receivedAt:new Date().toISOString()});else this.tradeDropped++;
      if(!this.flushTimer)this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.ctx.waitUntil(this.flush())},FLUSH_MS);
      return;
    }
    const tick=parsePolymarketUsLite(evt.data);
    if(!tick||!this.subscribed.has(tick.marketSlug))return;
    this.parsed++;
    const entry={...tick,ownerId:this.ctx.id?.toString?.()||null,tradeCount:this.tradeStats.get(tick.marketSlug)?.count||0,tradeWindowStart:this.tradeStats.get(tick.marketSlug)?.since||null,timeMs:Date.now(),at:new Date().toISOString()};
    if(!shouldSaveBbo(entry,this.lastSaved.get(tick.marketSlug)))return;
    // Collapse high-frequency ticks by contract, not by first-come-wins.
    // One latest tick per subscribed contract bounds memory without evicting quiet markets.
    this.queue.set(tick.marketSlug,entry);
    if(!this.flushTimer){
      this.flushTimer=setTimeout(()=>{
        this.flushTimer=null;
        this.ctx.waitUntil(this.flush());
      },FLUSH_MS);
    }
  }
  async ensureShadowQueue(){
    if(this.shadowLoaded)return;
    const stored=await this.ctx.storage.get("marketShadowPendingIds");
    this.shadowPendingIds=Array.isArray(stored)?stored:[];
    this.shadowLoaded=true;
  }
  async drainShadow(){
    if(this.env.MARKET_HISTORY_SHADOW_WS!=="enabled")return;
    if(this.shadowDrainPromise)return this.shadowDrainPromise;
    this.shadowDrainPromise=(async()=>{
      await this.ensureShadowQueue();
      // Four bounded 16-row chunks per invocation; alarm retries persisted backlog.
      for(let n=0;n<4&&this.shadowPendingIds.length;n++){
        const ids=this.shadowPendingIds.slice(0,16);
        try{
          const r=await mirrorPersistentStreamRows(this.env,ids);
          if(r.verified!==ids.length||r.sourceRowsDeleted!==0)throw Error("incomplete-shadow-receipt");
          this.shadowWritten+=r.written;this.shadowVerified+=r.verified;
          // Persist removal only after exact source/destination verification.
          this.shadowPendingIds=this.shadowPendingIds.slice(ids.length);
          await this.ctx.storage.put("marketShadowPendingIds",this.shadowPendingIds);
          this.lastShadowError=null;
        }catch{
          this.shadowFailed++;this.lastShadowError="shadow-reconciliation-failed";
          break;
        }
      }
    })();
    try{await this.shadowDrainPromise}finally{this.shadowDrainPromise=null}
  }
  async queueCommittedShadow(ids){
    if(this.env.MARKET_HISTORY_SHADOW_WS!=="enabled"||!ids?.length)return;
    await this.ensureShadowQueue();
    const unique=[...new Set([...this.shadowPendingIds,...ids])];
    if(unique.length>4096){
      this.shadowGap+=Math.max(0,unique.length-4096);
      this.lastShadowError="shadow-backlog-limit-reached";
      // Explicit unmirrored gap: independently backfill before read cutover.
      this.shadowPendingIds=unique.slice(0,4096);
    }else this.shadowPendingIds=unique;
    await this.ctx.storage.put("marketShadowPendingIds",this.shadowPendingIds);
    await this.drainShadow();
  }
  async spillFailedFlush(ticks,offers){
    if(!this.env.ARCHIVE?.put||!ticks?.length)return null;
    const at=new Date().toISOString();
    const key=`market-sources/polymarket-us/stream-spill/${at.slice(0,13)}/${Date.now()}.json`;
    await this.env.ARCHIVE.put(key,JSON.stringify({
      version:1,source:"Polymarket US WebSocket",kind:"d1-persist-failure-spill",
      capturedAt:at,tickCount:ticks.length,offerCount:offers.length,
      canAuthorizeWager:false,canQualify:false,
      reason:"primary-d1-persist-failed",
      primaryWriteOwner:"DB",
      recoveryOnly:true,
      ticks,offers,
    }),{httpMetadata:{contentType:"application/json"}});
    this.spilled+=ticks.length;
    this.lastSpillKey=key;this.lastSpillAt=at;
    this.lastCandidateDiagnostics={
      ...(this.lastCandidateDiagnostics||{}),
      lastSpillKey:key,lastSpillAt:at,lastSpillCount:ticks.length,
    };
    return key;
  }
  async flush(){
    if(this.tradeQueue.length&&this.env.ARCHIVE?.put){
      const prints=this.tradeQueue.splice(0,100);
      try{await this.env.ARCHIVE.put(`market-sources/polymarket-us/trades/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.json`,JSON.stringify({source:'Polymarket US WebSocket',capturedAt:new Date().toISOString(),prints,canAuthorizeWager:false}),{httpMetadata:{contentType:'application/json'}});}
      catch{this.tradeArchiveFailures++;this.tradeQueue.unshift(...prints);if(this.tradeQueue.length>500){this.tradeDropped+=this.tradeQueue.length-500;this.tradeQueue.length=500;}}
    }
    if(!this.queue.size){await this.drainShadow();return;}
    const ticks=[...this.queue.values()].slice(0,MAX_BATCH);
    for(const tick of ticks)this.queue.delete(tick.marketSlug);
    const offers=ticks.flatMap(t=>liveBboOffers(t,this.subscribed.get(t.marketSlug)));
    try{
      const r=await persistNormalizedMarketBatch(this.env.DB,offers,{
        snapshotType:"CURRENT",collectedAt:new Date().toISOString(),modelProbability:null
      });
      this.inserted+=r.inserted;
      this.persistenceStatus="HEALTHY";
      if(this.lastError==="d1-bbo-persist-error")this.lastError=null;
      for(const t of ticks)this.lastSaved.set(t.marketSlug,t);
      // Canonical D1 committed first; mirror failure must not change its truth.
      try{await this.queueCommittedShadow(r.ids)}
      catch{this.shadowFailed++;this.lastShadowError="shadow-queue-unavailable";}
    }catch{
      this.lastError="d1-bbo-persist-error";
      // Primary remains the write owner when healthy. While it is OVER_LIMIT,
      // recovery writes go to existing MARKET_HISTORY_DB + R2 spill — never
      // counted as primary `inserted`, never a second collector.
      let historyOk=false,spilledKey=null;
      try{
        const hr=await persistStreamRecoveryBatch(this.env,offers,{
          collectedAt:new Date().toISOString(),
        });
        if(hr.ok){
          this.historyInserted+=hr.inserted;historyOk=true;this.historyLastError=null;
        }else{
          this.historyLastError=hr.reason||"history-recovery-failed";
        }
      }catch(error){
        historyOk=false;
        this.historyLastError=String(error?.message||error||"history-recovery-exception").slice(0,240);
      }
      try{spilledKey=await this.spillFailedFlush(ticks,offers)}
      catch{spilledKey=null}
      if(historyOk||spilledKey){
        this.persistenceStatus=historyOk?"DEGRADED_HISTORY":"DEGRADED";
        for(const t of ticks)this.lastSaved.set(t.marketSlug,t);
      }else{
        this.persistenceStatus="UNAVAILABLE";
        for(const t of ticks)if(!this.queue.has(t.marketSlug))this.queue.set(t.marketSlug,t);
      }
    }
    if(this.queue.size){
      if(this.flushTimer)clearTimeout(this.flushTimer);
      this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.ctx.waitUntil(this.flush())},this.queue.size>MAX_BATCH?100:FLUSH_MS);
    }
  }
  async alarm(){
    if(!this.isCanonicalOwner()){await this.retireLegacyOwner();return;}
    await this.flush();
    await this.drainShadow();
    // Rotate before Cloudflare outbound keep-alive's 15-minute instance limit.
    if(this.running){await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);return;}
    if(!this.status().connected||[...this.sockets.values()].some(s=>Date.now()-s.lastMessageAt>2*RECONNECT_MS)||
        Date.now()-this.connectedAt>=ROTATE_MS||
        Date.now()-(this.lastMessageAt||this.connectedAt)>2*RECONNECT_MS){
      this.closeSockets("9-minute stream rotation");
      await this.connect();
    }else await this.ctx.storage.setAlarm(Date.now()+RECONNECT_MS);
  }
}

export {PolymarketMarketStreamCoverage as PolymarketMarketStream};

export default {
  async scheduled(_event,env,ctx){
    // Safe periodic reactivation after worker restarts/deployment. One DO
    // owns dynamic all-sport capacity (no competing collectors).
    // v2 cutover: long-lived WS pins prior DO isolates after deploy; a new
    // name forces one coordinated owner onto the latest Worker code.
    const id=env.PM_STREAM.idFromName("active-sports-fbis-v3");
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
      const stub=env.PM_STREAM.get(env.PM_STREAM.idFromName("active-sports-fbis-v3"));
      return stub.fetch("https://internal/start",{method:"POST"});
    }
    if(u.pathname!=="/health")return toJSON({ok:false,error:"not-found"},404);
    const stub=env.PM_STREAM.get(env.PM_STREAM.idFromName("active-sports-fbis-v3"));
    const r=await stub.fetch("https://internal/status");
    const status=await r.json();
    return toJSON({ok:true,source:"Polymarket US signed persistent market collector",
      mode:"DURABLE_OBJECT_DYNAMIC_CAPACITY",sports:STREAM_SPORTS,...status,
      workerSignerProxyConfigured:Boolean(env.FBIS_STREAM_PROXY_TOKEN),
      privateAccountAccess:false});
  }
};
