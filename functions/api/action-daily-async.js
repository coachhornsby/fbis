import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { queryGames } from "../lib/store.js";
import { loadFbisSlateForMatching } from "../lib/actionApifyEvidence.js";
import { buildCostLedgerEntry, matchEventWithConfidence } from "../lib/actionApifyCandidate.js";
import { buildActorInput, estimateActorCostUsd, fitMaxItemsToUsdBudget, normalizeActionDataset, ACTION_APIFY_ACTOR_ID } from "../lib/actionApifyShadow.js";
import { readCandidateConfig } from "../lib/actionApifyCandidateConfig.js";
import { actionShadowObservationKey, ensureShadowProviderRun, persistFullMarketObservation } from "../lib/actionApifyObservationStore.js";

const TZ="America/Chicago", SPORTS=["mlb","nfl","nba","nhl","cfb","cbb"];
const LEAGUE={mlb:"mlb",nfl:"nfl",nba:"nba",nhl:"nhl",cfb:"ncaaf",cbb:"ncaab"};
const PRO=new Set(["mlb","nfl","nba","nhl"]), PROFILE="DAILY", LIFECYCLE="daily", STALE_RUNNING_MS=30*60*1000;
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function dbOf(env){if(!env?.DB)return null;return{
 exec:async(s,p=[])=>env.DB.prepare(s).bind(...p).run(),
 queryOne:async(s,p=[])=>(await env.DB.prepare(s).bind(...p).first())||null,
 queryAll:async(s,p=[])=>(await env.DB.prepare(s).bind(...p).all()).results||[],
 batch:async(stmts=[])=>stmts.length?env.DB.batch(stmts.map(({sql,params=[]})=>env.DB.prepare(sql).bind(...params))):[]
}}
function parts(d=new Date()){const a=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(d),g=t=>a.find(x=>x.type===t)?.value||"";return{y:g("year"),m:g("month"),d:g("day"),h:Number(g("hour"))}}
function day(d=new Date()){const p=parts(d);return `${p.y}-${p.m}-${p.d}`}
function prev(k){const [y,m,d]=k.split("-").map(Number),x=new Date(Date.UTC(y,m-1,d,12));x.setUTCDate(x.getUTCDate()-1);return x.toISOString().slice(0,10)}
function sport(league){const k=String(league||"").toLowerCase();return k==="ncaaf"?"cfb":k==="ncaab"?"cbb":k}
function rowDay(t){const ms=Date.parse(String(t||""));return Number.isFinite(ms)?day(new Date(ms)):null}
async function slate(env,t,y){const all=[],by={};for(const s of SPORTS){let a={fbisEvents:[]},b={fbisEvents:[]};try{a=await loadFbisSlateForMatching(queryGames,env,{sport:s,date:t})}catch{}try{b=await loadFbisSlateForMatching(queryGames,env,{sport:s,date:y})}catch{}const x=a.fbisEvents||[],z=b.fbisEvents||[];by[s]={today:x.length,yesterday:z.length};all.push(...x,...z)}return{all,by}}
async function mtd(db,now=new Date()){const ms=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();const r=await db.queryOne("SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) usd FROM shadow_cost_ledger WHERE created_at >= ?",[ms]);return Number(r?.usd||0)}
function budget(env,now=new Date()){const n=Number(env.ACTION_APIFY_HARD_MONTHLY_BUDGET_USD),base=Number.isFinite(n)&&n>0?n:15;return now.getUTCFullYear()===2026&&now.getUTCMonth()===8?Math.max(base,25):base}
async function latest(db,t){return db.queryOne("SELECT * FROM shadow_collection_runs WHERE sport='all' AND profile=? AND lifecycle=? AND substr(started_at,1,10)=? ORDER BY started_at DESC LIMIT 1",[PROFILE,LIFECYCLE,t])}
async function active(db,t){return db.queryOne("SELECT * FROM shadow_collection_runs WHERE sport='all' AND profile=? AND lifecycle=? AND substr(started_at,1,10)=? AND status='running_daily' ORDER BY started_at DESC LIMIT 1",[PROFILE,LIFECYCLE,t])}
async function successfulRuns(db,t){const rows=await db.queryAll?.("SELECT * FROM shadow_collection_runs WHERE sport='all' AND profile=? AND lifecycle=? AND substr(started_at,1,10)=? AND status LIKE 'success%' ORDER BY started_at DESC",[PROFILE,LIFECYCLE,t]);return rows||[]}
async function successful(db,t){const rows=await successfulRuns(db,t);return rows[0]||null}
async function finalizeRun(db,run,{status,datasetId=null,gamesReturned=0,matched=0,unmatched=0,written=0,malformed=0,estimatedCostUsd=null,errorClass=null,errorMessage=null}){
 const finished=new Date().toISOString(),duration=Math.max(0,Date.now()-Date.parse(run.started_at));
 await db.exec(`UPDATE shadow_collection_runs SET status=?,dataset_id=COALESCE(?,dataset_id),games_returned=?,games_matched=?,games_unmatched=?,observations_written=?,malformed_rows=?,estimated_cost_usd=COALESCE(?,estimated_cost_usd),error_class=?,error_message=?,finished_at=?,duration_ms=? WHERE id=?`,[status,datasetId,gamesReturned,matched,unmatched,written,malformed,estimatedCostUsd,errorClass,errorMessage,finished,duration,run.id]);
}
export async function onRequestPost(context){
 const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
 const url=new URL(context.request.url);let body={};try{body=await context.request.json()}catch{}const mode=String(url.searchParams.get("mode")||body.mode||"start").toLowerCase();
 const db=dbOf(context.env);if(!db)return json({ok:false,status:"d1_unavailable"},503);const now=new Date(),today=day(now),yesterday=prev(today),cfg=readCandidateConfig(context.env);
 if(mode==="start"){
   let running=await active(db,today);
   if(running){
     const startedMs=Date.parse(String(running.started_at||"")),stale=!Number.isFinite(startedMs)||(Date.now()-startedMs)>STALE_RUNNING_MS;
     // One paid run per local day is a hard cost invariant. A stale local run
     // may simply mean the Actor succeeded while serverless persistence timed
     // out. Never abort/replace it from START; HARVEST is resumable and is the
     // only path allowed to reconcile the existing paid run.
     return json({ok:true,executed:false,status:"actor_running",stale,harvestRequired:true,runId:running.id,apifyRunId:running.apify_run_id,datasetId:running.dataset_id,today},202);
   }
   if(!cfg.enabled||!cfg.configured)return json({ok:true,executed:false,status:"action_not_configured",enabled:cfg.enabled,configured:cfg.configured});
   const sl=await slate(context.env,today,yesterday),activeSports=SPORTS.filter(s=>(sl.by[s]?.today||0)>0);
   if(!activeSports.length)return json({ok:true,executed:false,status:"no_slate",today,slate:sl.by});
   const doneRuns=await successfulRuns(db,today),done=doneRuns[0]||null;
   let collectionSports=[...activeSports];
   if(done){
     const priorSports=new Set();
     for(const priorRun of doneRuns){
       let prior={};try{prior=JSON.parse(priorRun.plan||"{}")}catch{}
       for(const s of prior.activeSports||[]) priorSports.add(s);
     }
     collectionSports=activeSports.filter(s=>!priorSports.has(s));
     if(!collectionSports.length)return json({ok:true,executed:false,status:"already_collected_today",runId:done.id,apifyRunId:done.apify_run_id,datasetId:done.dataset_id,today,activeSports});
   }
   const leagues=collectionSports.map(s=>LEAGUE[s]);
   const requested=Math.max(1,Math.min(200,sl.all.filter(g=>collectionSports.includes(sport(g?.league||g?.sport))).length+8)),per=Number(context.env.ACTION_APIFY_DAILY_RUN_BUDGET_USD||1),fit=cfg.plan==="starter"?fitMaxItemsToUsdBudget({leagues,periods:["event"],maxItems:requested,freePlan:false,includeLineMovement:true,includePlayerProps:false,gameStatus:"scheduled",onlyWithOdds:true},per):{maxItems:Math.min(10,requested)};
   const input=buildActorInput({leagues,periods:["event"],maxItems:fit.maxItems,freePlan:cfg.plan==="free",includeLineMovement:true,includePlayerProps:false,gameStatus:"scheduled",onlyWithOdds:true}),estimate=estimateActorCostUsd(input),spent=await mtd(db,now),cap=budget(context.env,now);
   if(spent+estimate>cap+1e-9)return json({ok:true,executed:false,status:"monthly_budget_blocked",monthToDateUsd:spent,estimatedNextRunUsd:estimate,monthlyBudgetUsd:cap});
   const token=String(context.env.APIFY_TOKEN||context.env.APIFY_API_TOKEN||"").trim();if(!token)return json({ok:false,status:"apify_not_configured"},503);
   const actorPath=encodeURIComponent(ACTION_APIFY_ACTOR_ID),res=await fetch(`https://api.apify.com/v2/acts/${actorPath}/runs?waitForFinish=0`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(input)});
   if(!res.ok)return json({ok:false,status:"apify_start_http",http:res.status},502);const j=await res.json(),a=j.data||j,runId=`daily_${today.replaceAll("-","")}_${crypto.randomUUID().replace(/-/g,"").slice(0,10)}`,started=new Date().toISOString(),plan=JSON.stringify({input,activeSports:collectionSports,fullActiveSports:activeSports,leagues,requestedRows:requested,estimatedCostUsd:estimate,today,yesterday});
   await db.exec(`INSERT INTO shadow_collection_runs(id,provider,mode,plan,profile,sport,lifecycle,status,enabled,apify_run_id,dataset_id,requested_max_items,estimated_cost_usd,cost_basis,started_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[runId,"ACTION_APIFY","shadow",plan,PROFILE,"all",LIFECYCLE,"running_daily",1,a.id||null,a.defaultDatasetId||null,input.maxItems,estimate,"ESTIMATED",started,started]);
   return json({ok:true,executed:true,status:"started_daily",runId,apifyRunId:a.id||null,datasetId:a.defaultDatasetId||null,today,estimatedCostUsd:estimate},202);
 }
 if(mode!=="harvest")return json({ok:false,status:"invalid_mode"},400);
 const run=await active(db,today);if(!run){const done=await successful(db,today);if(done)return json({ok:true,executed:false,status:"already_collected_today",runId:done.id,apifyRunId:done.apify_run_id,datasetId:done.dataset_id});const old=await latest(db,today);return json({ok:true,executed:false,status:old?"nothing_active_to_harvest":"nothing_to_harvest",lastStatus:old?.status||null,today});}
 if(!run.apify_run_id)return json({ok:false,status:"missing_apify_run_id",runId:run.id},500);
 const token=String(context.env.APIFY_TOKEN||context.env.APIFY_API_TOKEN||"").trim();if(!token)return json({ok:false,status:"apify_not_configured"},503);
 const rr=await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(run.apify_run_id)}`,{headers:{Authorization:`Bearer ${token}`}});if(!rr.ok)return json({ok:false,status:"apify_poll_http",http:rr.status},502);const rj=await rr.json(),ar=rj.data||rj,status=String(ar.status||"");
 if(status==="READY"||status==="RUNNING")return json({ok:true,executed:false,status:"actor_running",runId:run.id,apifyRunId:run.apify_run_id},202);
 if(status!=="SUCCEEDED"&&status!=="SUCCEEDED_WITH_WARNINGS"){await finalizeRun(db,run,{status:"failed_daily",errorClass:"daily_actor_failure",errorMessage:`apify-run-${status||"unknown"}`});return json({ok:false,executed:true,status:"failed_daily",runId:run.id,apifyRunId:run.apify_run_id,actorStatus:status},502)}
 const datasetId=ar.defaultDatasetId||run.dataset_id;if(!datasetId){await finalizeRun(db,run,{status:"failed_daily",errorClass:"missing_dataset_id",errorMessage:"Apify succeeded without a dataset id"});return json({ok:false,status:"missing_dataset_id",runId:run.id},502)}
 const dr=await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true`,{headers:{Authorization:`Bearer ${token}`}});if(!dr.ok)return json({ok:false,status:"apify_dataset_http",http:dr.status},502);
 const stableCollectedAt=ar.finishedAt||run.started_at||new Date().toISOString();
 const items=await dr.json();
 const norm=normalizeActionDataset(Array.isArray(items)?items:[],{runId:run.apify_run_id,receivedAt:stableCollectedAt,scrapedAt:stableCollectedAt});
 const sl=await slate(context.env,today,yesterday);
 const parsed=JSON.parse(run.plan||"{}"),input=parsed.input||{};
 await ensureShadowProviderRun(db,{runId:run.id,plan:{apifyRunId:run.apify_run_id,datasetId,input,profile:PROFILE,gamesReturned:norm.rows.length,malformedRows:norm.malformed,estimatedCostUsd:run.estimated_cost_usd},startedAt:run.started_at,finishedAt:ar.finishedAt||stableCollectedAt,status});

 // Normalize to the subset this daily run is allowed to persist, then collapse
 // exact retry duplicates by deterministic logical observation key.
 const unique=new Map();
 for(const row of norm.rows){
   const rd=rowDay(row.startTime);if(rd!==today&&rd!==yesterday)continue;
   const sp=sport(row.league);if(!SPORTS.includes(sp))continue;
   const key=actionShadowObservationKey(row,{runId:run.id});
   if(!unique.has(key))unique.set(key,{row,rd,sp,key});
 }
 const eligible=[...unique.values()];

 // Read existing progress once. This recognizes both deterministic v2 rows and
 // rows partially written by the pre-fix random-id implementation.
 const persisted=await db.queryAll(
   `SELECT action_game_id, period, source_observed_at, raw_payload_hash
      FROM shadow_market_observations WHERE run_id=?`,
   [run.id]
 );
 const existing=new Set((persisted||[]).map(x=>actionShadowObservationKey({
   actionGameId:x.action_game_id,
   period:x.period||"event",
   sourceObservedAt:x.source_observed_at||null,
   rawPayloadHash:x.raw_payload_hash||null,
 },{runId:run.id})));
 const pending=eligible.filter(x=>!existing.has(x.key));
 const configuredBatch=Number(context.env.ACTION_APIFY_HARVEST_BATCH_ROWS||4);
 const batchSize=Math.max(1,Math.min(12,Number.isFinite(configuredBatch)?Math.floor(configuredBatch):4));
 const batch=pending.slice(0,batchSize);

 let batchWritten=0,propsBatch=0;
 for(const item of batch){
   const {row,rd,sp}=item;
   const match=matchEventWithConfidence(row,sl.all);
   const close=rd===yesterday&&Boolean(row.result?.isFinal||/final|complete/i.test(String(row.status||"")));
   const isToday=rd===today;
   const pr=await persistFullMarketObservation(db,row,{
     runId:run.id,sport:sp,profile:PROFILE,
     lifecycle:close?"postgame":"daily_open",
     temporalClass:close?"evaluation_close":"pregame_observation",
     snapshotType:close?"CLOSE":"OPEN",
     match,collectedAt:stableCollectedAt,persistMovement:true,persistProps:isToday&&PRO.has(sp)
   });
   if(!pr?.skipped)batchWritten++;
   propsBatch+=Number(pr?.props||0);
 }

 // Recompute dataset-level counters from the immutable normalized dataset so
 // finalization is independent of how many HTTP chunks were required.
 let matched=0,unmatched=0,todayRows=0,closeRows=0;
 for(const item of eligible){
   const match=matchEventWithConfidence(item.row,sl.all);
   match.comparisonEligible?matched++:unmatched++;
   if(item.rd===today)todayRows++;
   if(item.rd===yesterday&&Boolean(item.row.result?.isFinal||/final|complete/i.test(String(item.row.status||""))))closeRows++;
 }
 const completedBefore=eligible.length-pending.length;
 const completedNow=completedBefore+batch.length;
 const remaining=Math.max(0,eligible.length-completedNow);

 if(remaining>0){
   return json({
     ok:true,executed:true,status:"harvest_partial",
     runId:run.id,apifyRunId:run.apify_run_id,datasetId,
     actorStatus:status,gamesReturned:norm.rows.length,eligibleRows:eligible.length,
     completedRows:completedNow,remainingRows:remaining,batchSize,batchWritten,propsWritten:propsBatch,
     collapsedDatasetDuplicates:Math.max(0,norm.rows.length-eligible.length)
   },202);
 }

 const estimated=estimateActorCostUsd(input,{gamesReturned:norm.rows.length}),cost=buildCostLedgerEntry({runId:run.id,plan:cfg.plan,sport:"all",profile:PROFILE,input,gamesReturned:norm.rows.length,createdAt:run.started_at});
 await finalizeRun(db,run,{status:"success_daily",datasetId,gamesReturned:norm.rows.length,matched,unmatched,written:eligible.length,malformed:norm.malformed,estimatedCostUsd:estimated});
 try{await db.exec(`INSERT OR IGNORE INTO shadow_cost_ledger(id,run_id,plan,sport,profile,cost_basis,run_start_usd,scoreboard_usd,row_usd,movement_usd,player_props_usd,game_props_usd,detail_usd,weather_usd,injuries_usd,standings_usd,futures_usd,estimated_total_usd,actual_total_usd,delta_usd,games_returned,features_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[cost.id,cost.run_id,cost.plan,cost.sport,cost.profile,cost.cost_basis,cost.run_start_usd,cost.scoreboard_usd,cost.row_usd,cost.movement_usd,cost.player_props_usd,cost.game_props_usd,cost.detail_usd,cost.weather_usd,cost.injuries_usd,cost.standings_usd,cost.futures_usd,cost.estimated_total_usd,cost.actual_total_usd,cost.delta_usd,cost.games_returned,cost.features_json,cost.created_at])}catch{}
 return json({ok:true,executed:true,status:"success_daily",runId:run.id,apifyRunId:run.apify_run_id,datasetId,gamesReturned:norm.rows.length,eligibleRows:eligible.length,matched,unmatched,observationsWritten:eligible.length,todayRows,closeRows,propsWrittenThisBatch:propsBatch,estimatedCostUsd:estimated,collapsedDatasetDuplicates:Math.max(0,norm.rows.length-eligible.length)},200);
}
