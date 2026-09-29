import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { querySnapshots } from "../lib/store.js";
import {
  LEARNING_SPORTS,
  snapshotModelId,
  snapshotMarketInformed,
  toModelLabRow,
  weeklyTrainingArtifact,
} from "../lib/snapshotLearning.js";
import { evaluateModelRows } from "../lib/modelLab.js";
import { queryModelLearningFindings } from "../lib/collegeStore.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

function finite(v){
  if(v==null || v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function millis(v){
  const n=Date.parse(String(v||""));
  return Number.isFinite(n)?n:null;
}

function isPregame(row={}){
  const frozen=millis(row.frozenAt);
  const start=millis(row.start);
  if(frozen==null) return false;
  return start==null ? true : frozen<=start;
}

function graded(row={}){
  return finite(row.actualHome)!=null && finite(row.actualAway)!=null;
}

function winnerCorrect(row={}){
  if(!graded(row)) return null;
  const pm=finite(row.projMargin);
  const am=finite(row.actualHome)-finite(row.actualAway);
  if(pm==null || am===0 || pm===0) return null;
  return (pm>0)===(am>0);
}

function canonicalRows(rows=[]){
  const groups=new Map();
  let rejectedPostStart=0;
  for(const row of rows){
    if(!isPregame(row)){
      rejectedPostStart+=1;
      continue;
    }
    const modelId=snapshotModelId(row);
    const gameId=String(row.gameId||row.id||"");
    if(!gameId) continue;
    const key=[String(row.sport||"").toLowerCase(),gameId,modelId].join("|");
    const cur=groups.get(key);
    if(!cur){
      groups.set(key,{...row,learningModelId:modelId,snapshotCount:1});
      continue;
    }
    cur.snapshotCount=(cur.snapshotCount||1)+1;
    if(millis(row.frozenAt)>millis(cur.frozenAt)){
      groups.set(key,{...row,learningModelId:modelId,snapshotCount:cur.snapshotCount});
    }
  }
  return {rows:[...groups.values()],rejectedPostStart};
}

function safeJson(v){
  if(v==null) return null;
  if(typeof v==="object") return v;
  try{return JSON.parse(v);}catch{return null;}
}

function conditionSummary(row={}){
  const layers=safeJson(row.layers)||{};
  const availability=layers.availability||layers._snap?.availability||null;
  const weather=layers.weather||layers._snap?.weather||null;
  const weatherImpact=layers.weatherImpact||layers._snap?.weatherImpact||null;
  const availabilityText=availability?.configured
    ? [
        availability.source||"availability",
        availability.homeScoreAdjustment!=null?`home ${Number(availability.homeScoreAdjustment)>=0?"+":""}${availability.homeScoreAdjustment}`:null,
        availability.awayScoreAdjustment!=null?`away ${Number(availability.awayScoreAdjustment)>=0?"+":""}${availability.awayScoreAdjustment}`:null,
        availability.criticalUnresolved?"critical unresolved":null,
        availability.stale?"stale":null,
      ].filter(Boolean).join("; ")
    : null;
  const weatherText=weather
    ? [
        weather.indoor?"indoor":null,
        weather.summary||weather.condition||weather.description||null,
        finite(weather.temperature)!=null?`${finite(weather.temperature)}°`:null,
        finite(weather.windSpeed)!=null?`wind ${finite(weather.windSpeed)}`:null,
        finite(weather.precipProbability)!=null?`precip ${finite(weather.precipProbability)}%`:null,
        finite(weatherImpact?.footballTotalFactor)!=null?`total factor ${finite(weatherImpact.footballTotalFactor)}`:null,
        finite(weatherImpact?.runFactor)!=null?`run factor ${finite(weatherImpact.runFactor)}`:null,
      ].filter(Boolean).join("; ")
    : null;
  return {availabilityText,weatherText};
}

function auditRow(row={}){
  const actualHome=finite(row.actualHome);
  const actualAway=finite(row.actualAway);
  const actualTotal=actualHome!=null&&actualAway!=null?actualHome+actualAway:null;
  const actualMargin=actualHome!=null&&actualAway!=null?actualHome-actualAway:null;
  const projectedTotal=finite(row.projTotal);
  const projectedMargin=finite(row.projMargin);
  const {availabilityText,weatherText}=conditionSummary(row);
  return {
    gameId:String(row.gameId||row.id||""),
    sport:String(row.sport||"").toUpperCase(),
    date:row.date||null,
    start:row.start||null,
    matchup:row.matchup||null,
    modelId:row.learningModelId||snapshotModelId(row),
    modelVersion:row.modelVersion||null,
    engine:row.engine||null,
    checkpoint:row.checkpoint||null,
    snapshotCount:Number(row.snapshotCount||1),
    frozenAt:row.frozenAt||null,
    projAway:finite(row.projAway),
    projHome:finite(row.projHome),
    projTotal:projectedTotal,
    projMargin:projectedMargin,
    pHome:finite(row.pHomeFinal??row.pHome),
    actualAway,
    actualHome,
    actualTotal,
    actualMargin,
    totalError:actualTotal!=null&&projectedTotal!=null?projectedTotal-actualTotal:null,
    marginError:actualMargin!=null&&projectedMargin!=null?projectedMargin-actualMargin:null,
    winnerCorrect:winnerCorrect(row),
    gradedAt:row.gradedAt||null,
    projectionKind:row.projectionKind||null,
    marketInformed:snapshotMarketInformed(row),
    dataQuality:finite(row.dataQuality),
    projectionFlags:Array.isArray(row.projectionFlags)?row.projectionFlags.join("|"):row.projectionFlags||null,
    weather:weatherText,
    availability:availabilityText,
    learningStatus:graded(row)?"GRADED / INCLUDED":"AWAITING FINAL",
  };
}

async function latestTraining(env,modelId){
  if(!env?.DB?.prepare) return null;
  try{
    const row=await env.DB.prepare(
      `SELECT model_id, method, train_until, validate_from, validate_until, n,
              metrics_json, leakage_ok, created_at
         FROM model_validation_runs
        WHERE model_id = ? AND method = 'weekly-auto-train-calibration-v1'
        ORDER BY created_at DESC
        LIMIT 1`
    ).bind(modelId).first();
    if(!row) return null;
    let metrics={};
    try{metrics=row.metrics_json?JSON.parse(row.metrics_json):{};}catch{}
    return {
      modelId:row.model_id,
      method:row.method,
      trainUntil:row.train_until,
      validateFrom:row.validate_from,
      validateUntil:row.validate_until,
      n:Number(row.n)||0,
      leakageOk:Number(row.leakage_ok)===1,
      createdAt:row.created_at,
      artifact:metrics?.artifact||null,
      source:metrics?.source||null,
    };
  }catch{
    return null;
  }
}

function lastIso(rows=[],field){
  return rows.map(r=>r?.[field]).filter(Boolean).sort().at(-1)||null;
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  const url=new URL(context.request.url);
  const since=url.searchParams.get("since")||"2026-01-01";
  const auditLimit=Math.max(100,Math.min(5000,Number(url.searchParams.get("limit")||5000)));
  const env={DB:context.env.DB,caches:caches.default};

  const sportResults=[];
  const allAudit=[];
  const errors=[];
  let totalSnapshotRows=0;
  let totalCanonical=0;
  let totalGraded=0;
  let totalAwaiting=0;
  let totalPostStart=0;

  for(const sport of LEARNING_SPORTS){
    const queried=await querySnapshots(env,{sport,since});
    if(!queried.ok){
      errors.push(`${sport}:${queried.reason||"query-failed"}`);
      sportResults.push({sport:sport.toUpperCase(),ok:false,error:queried.reason||"query-failed",models:[]});
      continue;
    }

    totalSnapshotRows+=(queried.rows||[]).length;
    const selected=canonicalRows(queried.rows||[]);
    totalCanonical+=selected.rows.length;
    totalPostStart+=selected.rejectedPostStart;

    const byModel=new Map();
    for(const row of selected.rows){
      const modelId=row.learningModelId||snapshotModelId(row);
      if(!byModel.has(modelId)) byModel.set(modelId,[]);
      byModel.get(modelId).push(row);
      allAudit.push(auditRow(row));
    }

    const models=[];
    for(const [modelId,rows] of byModel.entries()){
      const gradedRows=rows.filter(graded);
      const awaiting=rows.length-gradedRows.length;
      totalGraded+=gradedRows.length;
      totalAwaiting+=awaiting;
      const metrics=evaluateModelRows(gradedRows.map(toModelLabRow),{sport});
      const preview=weeklyTrainingArtifact(gradedRows,{sport,modelId});
      const trained=await latestTraining(env,modelId);
      const findings=await queryModelLearningFindings(context.env,{sport,modelId,status:"OPEN",limit:200});
      const marketInformed=rows.some(snapshotMarketInformed);
      models.push({
        sport:sport.toUpperCase(),
        modelId,
        projectedGames:rows.length,
        gradedGames:gradedRows.length,
        awaitingFinals:awaiting,
        metrics,
        currentTrainingPreview:preview,
        lastTraining:trained,
        openFindings:findings.length,
        marketInformed,
        lastFrozenAt:lastIso(rows,"frozenAt"),
        lastGradedAt:lastIso(gradedRows,"gradedAt"),
      });
    }

    sportResults.push({
      sport:sport.toUpperCase(),
      ok:true,
      snapshotRows:(queried.rows||[]).length,
      canonicalProjections:selected.rows.length,
      gradedProjections:selected.rows.filter(graded).length,
      awaitingFinals:selected.rows.filter(r=>!graded(r)).length,
      rejectedPostStart:selected.rejectedPostStart,
      models,
    });
  }

  allAudit.sort((a,b)=>{
    const da=String(a.date||"");
    const db=String(b.date||"");
    if(da!==db) return db.localeCompare(da);
    if(a.sport!==b.sport) return a.sport.localeCompare(b.sport);
    return String(a.matchup||"").localeCompare(String(b.matchup||""));
  });

  return json({
    ok:errors.length===0,
    status:errors.length?"degraded":"success",
    source:"prediction_snapshots",
    since,
    totals:{
      snapshotRows:totalSnapshotRows,
      canonicalProjections:totalCanonical,
      gradedProjections:totalGraded,
      awaitingFinals:totalAwaiting,
      rejectedPostStart:totalPostStart,
    },
    sports:sportResults,
    audit:allAudit.slice(0,auditLimit),
    auditTruncated:allAudit.length>auditLimit,
    errors,
    generatedAt:new Date().toISOString(),
    note:"D1 prediction_snapshots is authoritative. The audit exposes the latest valid pregame projection per game/model while snapshotCount proves how many immutable checkpoints were retained for that game/model.",
  },errors.length?207:200);
}
