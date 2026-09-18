import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { queryGames } from "../lib/store.js";
import { loadFbisSlateForMatching } from "../lib/actionApifyEvidence.js";
import { buildCostLedgerEntry, matchEventWithConfidence } from "../lib/actionApifyCandidate.js";
import { buildActorInput, estimateActorCostUsd, fitMaxItemsToUsdBudget, normalizeActionDataset, ACTION_APIFY_ACTOR_ID } from "../lib/actionApifyShadow.js";
import { readCandidateConfig } from "../lib/actionApifyCandidateConfig.js";
import { ensureShadowProviderRun, persistFullMarketObservation } from "../lib/actionApifyObservationStore.js";
import { persistCandidateRunArtifacts } from "../lib/actionApifyCollector.js";

const TZ="America/Chicago", SPORTS=["mlb","nfl","nba","nhl","cfb","cbb"];
const LEAGUE={mlb:"mlb",nfl:"nfl",nba:"nba",nhl:"nhl",cfb:"ncaaf",cbb:"ncaab"};
const PRO=new Set(["mlb","nfl","nba","nhl"]), PROFILE="DAILY", LIFECYCLE="daily";
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function dbOf(env){if(!env?.DB)return null;return{exec:async(s,p=[])=>env.DB.prepare(s).bind(...p).run(),queryOne:async(s,p=[])=>(await env.DB.prepare(s).bind(...p).first())||null,queryAll:async(s,p=[])=>((await env.DB.prepare(s).bind(...p).all())?.results||[])}}
function parts(d=new Date()){const a=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(d),g=t=>a.find(x=>x.type===t)?.value||"";return{y:g("year"),m:g("month"),d:g("day"),h:Number(g("hour"))}}
function day(d=new Date()){const p=parts(d);return `${p.y}-${p.m}-${p.d}`}
function prev(k){const [y,m,d]=k.split("-").map(Number),x=new Date(Date.UTC(y,m-1,d,12));x.setUTCDate(x.getUTCDate()-1);return x.toISOString().slice(0,10)}
function sport(league){const k=String(league||"").toLowerCase();return k==="ncaaf"?"cfb":k==="ncaab"?"cbb":k}
function rowDay(t){const ms=Date.parse(String(t||""));return Number.isFinite(ms)?day(new Date(ms)):null}
async function slate(env,t,y){const all=[],by={};for(const s of SPORTS){let a={fbisEvents:[]},b={fbisEvents:[]};try{a=await loadFbisSlateForMatching(queryGames,env,{sport:s,date:t})}catch{}try{b=await loadFbisSlateForMatching(queryGames,env,{sport:s,date:y})}catch{}const x=a.fbisEvents||[],z=b.fbisEvents||[];by[s]={today:x.length,yesterday:z.length};all.push(...x,...z)}return{all,by}}
async function mtd(db,now=new Date()){const ms=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();const r=await db.queryOne("SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) usd FROM shadow_cost_ledger WHERE created_at >= ?",[ms]);return Number(r?.usd||0)}
function budget(env,now=new Date()){const n=Number(env.ACTION_APIFY_HARD_MONTHLY_BUDGET_USD),base=Number.isFinite(n)&&n>0?n:15;return now.getUTCFullYear()===2026&&now.getUTCMonth()===8?Math.max(base,25):base}
async function prior(db,t){return db.queryOne("SELECT * FROM shadow_collection_runs WHERE sport='all' AND profile=? AND lifecycle=? AND substr(started_at,1,10)>=? ORDER BY started_at DESC LIMIT 1",[PROFILE,LIFECYCLE,t])}
function artifact(run,cfg,status,actor,stats,cost){return{run:{id:run.id,plan:cfg.plan,profile:PROFILE,sport:"all",lifecycle:LIFECYCLE,status,overlapBlocked:false,budgetBlocked:false,circuitOpen:false,apifyRunId:actor.runId,datasetId:actor.datasetId,requestedMaxItems:actor.input?.maxItems??null,gamesExpected:null,gamesReturned:actor.gamesReturned||0,gamesMatched:stats.matched,gamesUnmatched:stats.unmatched,observationsWritten:stats.written,duplicatesSkipped:0,malformedRows:actor.malformed||0,schemaFingerprint:null,schemaDriftLevel:null,estimatedCostUsd:actor.estimatedCostUsd??cost?.estimated_total_usd??null,actualCostUsd:null,costBasis:"ESTIMATED",errorClass:status.startsWith("success")?null:"daily_actor_failure",errorMessage:null,startedAt:run.started_at,finishedAt:new Date().toISOString(),durationMs:Date.now()-Date.parse(run.started_at),createdAt:run.started_at},cost}}
export async function onRequestPost(context){
 const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
 const url=new URL(context.request.url);let body={};try{body=await context.request.json()}catch{}const mode=String(url.searchParams.get("mode")||body.mode||"start").toLowerCase();
 const db=dbOf(context.env);if(!db)return json({ok:false,status:"d1_unavailable"},503);const now=new Date(),today=day(now),yesterday=prev(today),cfg=readCandidateConfig(context.env);
 if(mode==="start"){
   const existing=await prior(db,today);if(existing){return json({ok:true,executed:false,status:existing.status,runId:existing.id,apifyRunId:existing.apify_run_id,datasetId:existing.dataset_id,today})}
   if(!cfg.enabled||!cfg.configured)return json({ok:true,executed:false,status:"action_not_configured"});
   const sl=await slate(context.env,today,yesterday),active=SPORTS.filter(s=>(sl.by[s]?.today||0)+(sl.by[s]?.yesterday||0)>0),leagues=active.map(s=>LEAGUE[s]);if(!leagues.length)return json({ok:true,executed:false,status:"no_slate"});
   const requested=Math.max(1,Math.min(200,sl.all.length+12)),per=Number(context.env.ACTION_APIFY_DAILY_RUN_BUDGET_USD||1),fit=cfg.plan==="starter"?fitMaxItemsToUsdBudget({leagues,periods:["event"],maxItems:requested,freePlan:false,includeLineMovement:true,includePlayerProps:true,gameStatus:"any",onlyWithOdds:true},per):{maxItems:Math.min(10,requested)};
   const input=buildActorInput({leagues,periods:["event"],maxItems:fit.maxItems,freePlan:cfg.plan==="free",includeLineMovement:true,includePlayerProps:true,gameStatus:"any",onlyWithOdds:true}),estimate=estimateActorCostUsd(input),spent=await mtd(db,now),cap=budget(context.env,now);
   if(spent+estimate>cap+1e-9)return json({ok:true,executed:false,status:"monthly_budget_blocked",monthToDateUsd:spent,estimatedNextRunUsd:estimate,monthlyBudgetUsd:cap});
   const token=String(context.env.APIFY_TOKEN||context.env.APIFY_API_TOKEN||"").trim();if(!token)return json({ok:false,status:"apify_not_configured"},503);
   const actorPath=encodeURIComponent(ACTION_APIFY_ACTOR_ID),res=await fetch(`https://api.apify.com/v2/acts/${actorPath}/runs?waitForFinish=0`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(input)});
   if(!res.ok)return json({ok:false,status:"apify_start_http",http:res.status},502);const j=await res.json(),a=j.data||j,runId=`daily_${today.replaceAll("-","")}_${crypto.randomUUID().replace(/-/g,"").slice(0,10)}`,started=new Date().toISOString(),plan=JSON.stringify({input,activeSports:active,leagues,requestedRows:requested,estimatedCostUsd:estimate,today,yesterday});
   await db.exec(`INSERT INTO shadow_collection_runs(id,provider,mode,plan,profile,sport,lifecycle,status,enabled,apify_run_id,dataset_id,requested_max_items,estimated_cost_usd,cost_basis,started_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[runId,"ACTION_APIFY","shadow",plan,PROFILE,"all",LIFECYCLE,"running_daily",1,a.id||null,a.defaultDatasetId||null,input.maxItems,estimate,"ESTIMATED",started,started]);
   return json({ok:true,executed:true,status:"started_daily",runId,apifyRunId:a.id||null,datasetId:a.defaultDatasetId||null,today,estimatedCostUsd:estimate},202);
 }
 if(mode!=="harvest")return json({ok:false,status:"invalid_mode"},400);
 const run=await prior(db,today);if(!run)return json({ok:true,executed:false,status:"nothing_to_harvest",today});
 if(String(run.status).startsWith("success"))return json({ok:true,executed:false,status:run.status,runId:run.id,apifyRunId:run.apify_run_id});
 if(!run.apify_run_id)return json({ok:false,status:"missing_apify_run_id",runId:run.id},500);
 const token=String(context.env.APIFY_TOKEN||context.env.APIFY_API_TOKEN||"").trim(),rr=await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(run.apify_run_id)}`,{headers:{Authorization:`Bearer ${token}`}});
 if(!rr.ok)return json({ok:false,status:"apify_poll_http",http:rr.status},502);const rj=await rr.json(),ar=rj.data||rj,status=String(ar.status||"");
 if(status==="READY"||status==="RUNNING")return json({ok:true,executed:false,status:"actor_running",runId:run.id,apifyRunId:run.apify_run_id},202);
 if(status!=="SUCCEEDED"&&status!=="SUCCEEDED_WITH_WARNINGS"){await db.exec("UPDATE shadow_collection_runs SET status=?,error_class=?,error_message=?,finished_at=? WHERE id=?",["failed_daily","daily_actor_failure",`apify-run-${status||"unknown"}`,new Date().toISOString(),run.id]);return json({ok:false,executed:true,status:"failed_daily",actorStatus:status},502)}
 const datasetId=ar.defaultDatasetId||run.dataset_id;if(!datasetId)return json({ok:false,status:"missing_dataset_id"},502);
 const dr=await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true`,{headers:{Authorization:`Bearer ${token}`}});if(!dr.ok)return json({ok:false,status:"apify_dataset_http",http:dr.status},502);
 const items=await dr.json(),norm=normalizeActionDataset(Array.isArray(items)?items:[],{runId:run.apify_run_id,receivedAt:new Date().toISOString(),scrapedAt:ar.finishedAt||new Date().toISOString()}),sl=await slate(context.env,today,yesterday);let matched=0,unmatched=0,written=0,todayRows=0,closeRows=0,props=0;
 await ensureShadowProviderRun(db,{runId:run.id,plan:{apifyRunId:run.apify_run_id,datasetId,input:JSON.parse(run.plan).input,profile:PROFILE,gamesReturned:norm.rows.length,malformedRows:norm.malformed,estimatedCostUsd:run.estimated_cost_usd},startedAt:run.started_at,finishedAt:new Date().toISOString(),status});
 for(const row of norm.rows){const rd=rowDay(row.startTime);if(rd!==today&&rd!==yesterday)continue;const sp=sport(row.league);if(!SPORTS.includes(sp))continue;const match=matchEventWithConfidence(row,sl.all);match.comparisonEligible?matched++:unmatched++;const close=rd===yesterday&&Boolean(row.result?.isFinal||/final|complete/i.test(String(row.status||""))),isToday=rd===today;if(isToday)todayRows++;if(close)closeRows++;const pr=await persistFullMarketObservation(db,row,{runId:run.id,sport:sp,profile:PROFILE,lifecycle:close?"postgame":"daily_open",temporalClass:close?"evaluation_close":"pregame_observation",snapshotType:close?"CLOSE":"OPEN",match,collectedAt:new Date().toISOString(),persistMovement:true,persistProps:isToday&&PRO.has(sp)});written++;props+=Number(pr?.props||0)}
 const input=JSON.parse(run.plan).input,actor={ok:true,runId:run.apify_run_id,datasetId,input,rows:norm.rows,malformed:norm.malformed,gamesReturned:norm.rows.length,estimatedCostUsd:estimateActorCostUsd(input,{gamesReturned:norm.rows.length})},cost=buildCostLedgerEntry({runId:run.id,plan:cfg.plan,sport:"all",profile:PROFILE,input,gamesReturned:norm.rows.length,createdAt:run.started_at}),stats={matched,unmatched,written};
 await persistCandidateRunArtifacts(db,artifact(run,cfg,"success_daily",actor,stats,cost));
 return json({ok:true,executed:true,status:"success_daily",runId:run.id,apifyRunId:run.apify_run_id,datasetId,gamesReturned:norm.rows.length,matched,unmatched,observationsWritten:written,todayRows,closeRows,propsWritten:props,estimatedCostUsd:actor.estimatedCostUsd},200);
}
