import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { planCandidateCollection, evaluateSchedulerSafety, runCandidateCollection } from "../lib/actionApifyCollector.js";
import { queryMonthToDateSpendUsd } from "../lib/actionApifyDurableState.js";
import { assertActionApifyNotInProductionRouter } from "../lib/actionApifyShadow.js";
import { ODDS_PROVIDER_ORDER } from "../lib/oddsProviderRouter.js";

function json(body,status=200){ return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}}); }
function db(env){
  if(!env?.DB) return null;
  return {
    exec: async (sql,params=[])=>env.DB.prepare(sql).bind(...params).run(),
    batch: async (statements=[])=> statements.length ? env.DB.batch(statements.map(({sql,params=[]})=>env.DB.prepare(sql).bind(...params))) : [],
    queryOne: async (sql,params=[])=>env.DB.prepare(sql).bind(...params).first(),
    queryAll: async (sql,params=[])=>((await env.DB.prepare(sql).bind(...params).all())?.results||[]),
    getObservationKey: async (k)=>env.DB.prepare("SELECT * FROM shadow_observation_keys WHERE natural_key = ?").bind(k).first(),
    putObservationKey: async (row)=>env.DB.prepare(`INSERT OR REPLACE INTO shadow_observation_keys (
      natural_key, observation_id, run_id, provider, action_game_id, market, period, book,
      source_observed_at, collected_at, payload_hash, created_at, run_idempotency_key, sampling_kind,
      fbis_event_id, line, price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      row.natural_key,row.observation_id,row.run_id,row.provider,row.action_game_id,row.market,row.period,row.book,
      row.source_observed_at,row.collected_at,row.payload_hash,row.created_at,row.run_idempotency_key||null,
      row.sampling_kind||null,row.fbis_event_id||null,row.line??null,row.price??null
    ).run(),
  };
}

function optsFrom(v={}){
  const sport=String(v.sport||"").toLowerCase();
  const season=Number(v.season);
  const week=Number(v.week);
  const maxItems=Number(v.maxItems);
  return {
    sport,
    lifecycle:String(v.lifecycle||"postgame").toLowerCase(),
    profile:String(v.profile||"FINAL").toUpperCase(),
    date:v.date?String(v.date):undefined,
    season:Number.isFinite(season)?season:undefined,
    week:Number.isFinite(week)?week:undefined,
    seasonType:v.seasonType?String(v.seasonType):undefined,
    gameStatus:v.gameStatus?String(v.gameStatus):"complete",
    onlyWithOdds:v.onlyWithOdds!==false,
    maxItems:Number.isFinite(maxItems)&&maxItems>0?Math.min(200,Math.floor(maxItems)):120,
    fitBudgetUsd:Number(v.fitBudgetUsd)>0?Math.min(5,Number(v.fitBudgetUsd)):0.75,
  };
}

export async function onRequestGet(context){
  assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER);
  const auth=authorizeHarvest(context.request,context.env); if(!auth.ok) return json(unauthorizedBody(),401);
  const u=new URL(context.request.url);
  const opts=optsFrom(Object.fromEntries(u.searchParams.entries()));
  if(!opts.sport) return json({ok:false,error:"sport-required"},400);
  const d=db(context.env);
  const researchEnv=context.env;
  const plan=planCandidateCollection(researchEnv,opts);
  const mtd=await queryMonthToDateSpendUsd(d);
  const safety=evaluateSchedulerSafety(plan,{monthToDateCostUsd:mtd.mtdUsd});
  return json({ok:true,executed:false,plan:{sport:plan.sport,profile:plan.profile,input:plan.input,estimatedCostUsd:plan.estimatedCostUsd},budget:{monthToDateCostUsd:mtd.mtdUsd,monthlyBudgetUsd:plan.cfg.monthlyBudgetUsd,remainingBudgetUsd:Math.max(0,plan.cfg.monthlyBudgetUsd-mtd.mtdUsd)},safety,inProductionRouter:false,canQualify:false,canAuthorizeWager:false});
}

export async function onRequestPost(context){
  assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER);
  const auth=authorizeHarvest(context.request,context.env); if(!auth.ok) return json(unauthorizedBody(),401);
  let body={}; try{body=await context.request.json();}catch{}
  const opts=optsFrom(body);
  if(!opts.sport) return json({ok:false,error:"sport-required"},400);
  const d=db(context.env);
  const researchEnv=context.env;
  const plan=planCandidateCollection(researchEnv,opts);
  const mtd=await queryMonthToDateSpendUsd(d);
  const safety=evaluateSchedulerSafety(plan,{monthToDateCostUsd:mtd.mtdUsd});
  if(!safety.allowed) return json({ok:false,executed:false,status:"blocked",blocks:safety.blocks,budget:safety,inProductionRouter:false,canQualify:false,canAuthorizeWager:false},409);
  const result=await runCandidateCollection(researchEnv,{...opts,maxItems:plan.input.maxGames,fbisEvents:[],gamesExpected:null,db:d,monthToDateCostUsd:mtd.mtdUsd});
  return json({...result,rows:undefined,executed:true,inProductionRouter:false,canQualify:false,canAuthorizeWager:false},result.ok?200:502);
}
