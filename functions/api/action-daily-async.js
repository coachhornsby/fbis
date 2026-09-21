import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { queryGames } from "../lib/store.js";
import { loadFbisSlateForMatching } from "../lib/actionApifyEvidence.js";
import { buildCostLedgerEntry, matchEventWithConfidence } from "../lib/actionApifyCandidate.js";
import { buildActorInput, estimateActorCostUsd, fitMaxItemsToUsdBudget, normalizeActionDataset, ACTION_APIFY_ACTOR_ID } from "../lib/actionApifyShadow.js";
import { readCandidateConfig } from "../lib/actionApifyCandidateConfig.js";
import { ensureShadowProviderRun, persistFullMarketObservation } from "../lib/actionApifyObservationStore.js";

const TZ="America/Chicago", SPORTS=["mlb","nfl","nba","nhl","cfb","cbb"];
const LEAGUE={mlb:"mlb",nfl:"nfl",nba:"nba",nhl:"nhl",cfb:"ncaaf",cbb:"ncaab"};
const PRO=new Set(["mlb","nfl","nba","nhl"]), PROFILE="DAILY", LIFECYCLE="daily", STALE_RUNNING_MS=30*60*1000;
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function dbOf(env){if(!env?.DB)return null;return{exec:async(s,p=[])=>env.DB.prepare(s).bind(...p).run(),queryOne:async(s,p=[])=>(await env.DB.prepare(s).bind(...p).first())||null}}
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
async function successful(db,t){return db.queryOne("SELECT * FROM shadow_collection_runs WHERE sport='all' AND profile=? AND lifecycle=? AND substr(started_at,1,10)=? AND status LIKE 'success%' ORDER BY started_at DESC LIMIT 1",[PROFILE,LIFECYCLE,t])}
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
     if(!stale)return json({ok:true,executed:false,status:"actor_running",runId:running.id,apifyRunId:running.apify_run_id,datasetId:running.dataset_id,today},202);
     const token=String(context.env.APIFY_TOKEN||context.env.APIFY_API_TOKEN||"").trim();
     if(token&&running.apify_run_id){
       try{await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(running.apify_run_id)}/abort`,{method:"POST",headers:{Authorization:`Bearer ${token}`}})}catch{}
     }
     await finalizeRun(db,running,{status:"failed_daily",errorClass:"stale_daily_replaced",errorMessage:"daily Actor exceeded 30-minute running window and was replaced"});
     running=null;
   }
   if(!cfg.enabled||!cfg.configured)return json({ok:true,executed:false,status:"action_not_configured",enabled:cfg.enabled,configured:cfg.configured});
   const sl=await slate(context.env,today,yesterday),activeSports=SPORTS.filter(s=>(sl.by[s]?.today||0)>0);
   if(!activeSports.length)return json({ok:true,executed:false,status:"no_slate",today,slate:sl.by});
   const done=await successful(db,today);
   let collectionSports=[...activeSports];
   if(done){
     let prior={};try{prior=JSON.parse(done.plan||"{}")}catch{}
     const priorSports=new Set(prior.activeSports||[]);
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
 const items=await dr.json(),norm=normalizeActionDataset(Array.isArray(items)?items:[],{runId:run.apify_run_id,receivedAt:new Date().toISOString(),scrapedAt:ar.finishedAt||new Date().toISOString()}),sl=await slate(context.env,today,yesterday);let matched=0,unmatched=0,written=0,todayRows=0,closeRows=0,props=0;
 const parsed=JSON.parse(run.plan||"{}"),input=parsed.input||{};
 await ensureShadowProviderRun(db,{runId:run.id,plan:{apifyRunId:run.apify_run_id,datasetId,input,profile:PROFILE,gamesReturned:norm.rows.length,malformedRows:norm.malformed,estimatedCostUsd:run.estimated_cost_usd},startedAt:run.started_at,finishedAt:new Date().toISOString(),status});
 for(const row of norm.rows){const rd=rowDay(row.startTime);if(rd!==today&&rd!==yesterday)continue;const sp=sport(row.league);if(!SPORTS.includes(sp))continue;const match=matchEventWithConfidence(row,sl.all);match.comparisonEligible?matched++:unmatched++;const close=rd===yesterday&&Boolean(row.result?.isFinal||/final|complete/i.test(String(row.status||""))),isToday=rd===today;if(isToday)todayRows++;if(close)closeRows++;const pr=await persistFullMarketObservation(db,row,{runId:run.id,sport:sp,profile:PROFILE,lifecycle:close?"postgame":"daily_open",temporalClass:close?"evaluation_close":"pregame_observation",snapshotType:close?"CLOSE":"OPEN",match,collectedAt:new Date().toISOString(),persistMovement:true,persistProps:isToday&&PRO.has(sp)});written++;props+=Number(pr?.props||0)}
 const estimated=estimateActorCostUsd(input,{gamesReturned:norm.rows.length}),cost=buildCostLedgerEntry({runId:run.id,plan:cfg.plan,sport:"all",profile:PROFILE,input,gamesReturned:norm.rows.length,createdAt:run.started_at});
 await finalizeRun(db,run,{status:"success_daily",datasetId,gamesReturned:norm.rows.length,matched,unmatched,written,malformed:norm.malformed,estimatedCostUsd:estimated});
 try{await db.exec(`INSERT OR IGNORE INTO shadow_cost_ledger(id,run_id,plan,sport,profile,cost_basis,run_start_usd,scoreboard_usd,row_usd,movement_usd,player_props_usd,game_props_usd,detail_usd,weather_usd,injuries_usd,standings_usd,futures_usd,estimated_total_usd,actual_total_usd,delta_usd,games_returned,features_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[cost.id,cost.run_id,cost.plan,cost.sport,cost.profile,cost.cost_basis,cost.run_start_usd,cost.scoreboard_usd,cost.row_usd,cost.movement_usd,cost.player_props_usd,cost.game_props_usd,cost.detail_usd,cost.weather_usd,cost.injuries_usd,cost.standings_usd,cost.futures_usd,cost.estimated_total_usd,cost.actual_total_usd,cost.delta_usd,cost.games_returned,cost.features_json,cost.created_at])}catch{}
 return json({ok:true,executed:true,status:"success_daily",runId:run.id,apifyRunId:run.apify_run_id,datasetId,gamesReturned:norm.rows.length,matched,unmatched,observationsWritten:written,todayRows,closeRows,propsWritten:props,estimatedCostUsd:estimated},200);
}
