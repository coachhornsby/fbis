import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { LEARNING_SPORTS } from "../lib/snapshotLearning.js";

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

function safeJson(v){
  if(v==null) return null;
  if(typeof v==="object") return v;
  try{return JSON.parse(v);}catch{return null;}
}

function modelId(row={}){
  const engine=String(row.engine||"").trim();
  const version=String(row.model_version||row.modelVersion||"").trim();
  if(engine && version && engine!==version) return `${engine}@${version}`;
  return engine||version||`${String(row.sport||"unknown").toUpperCase()}-SNAPSHOT`;
}

function marketInformed(row={}){
  const kind=String(row.projection_kind||row.projectionKind||"").toUpperCase();
  const engine=String(row.engine||"").toUpperCase();
  const flags=String(row.projection_flags||row.projectionFlags||"");
  return (
    kind.includes("PINNACLE_IMPLIED") ||
    kind.includes("MARKET_IMPLIED") ||
    /PINNACLE|MARKET[-_ ]?IMPLIED|BOARD[-_ ]?LINE[-_ ]?IMPLIED/.test(engine) ||
    /pinnacle_implied_score|market_implied/i.test(flags)
  );
}

function conditionSummary(row={}){
  const layers=safeJson(row.layers_json)||{};
  const snap=layers._snap||{};
  const availability=layers.availability||snap.availability||null;
  const weather=layers.weather||snap.weather||null;
  const weatherImpact=layers.weatherImpact||snap.weatherImpact||null;
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

function parseTrainingRow(row){
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
}

async function allRows(db,sql,binds=[]){
  const res=await db.prepare(sql).bind(...binds).all();
  return res?.results||[];
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  if(!context.env?.DB?.prepare) return json({ok:false,error:"d1-unbound"},503);

  const url=new URL(context.request.url);
  const since=url.searchParams.get("since")||"2026-01-01";
  const auditLimit=Math.max(100,Math.min(5000,Number(url.searchParams.get("limit")||5000)));
  const db=context.env.DB;

  try{
    const startExpr=`COALESCE(json_extract(layers_json,'$._snap.start'), json_extract(pal_json,'$.start'))`;
    const modelExpr=`CASE
      WHEN COALESCE(engine,'') != '' AND COALESCE(model_version,'') != '' AND engine != model_version
        THEN engine || '@' || model_version
      WHEN COALESCE(engine,'') != '' THEN engine
      WHEN COALESCE(model_version,'') != '' THEN model_version
      ELSE upper(sport) || '-SNAPSHOT'
    END`;
    const marketExpr=`CASE WHEN
      upper(COALESCE(projection_kind,'')) LIKE '%PINNACLE_IMPLIED%' OR
      upper(COALESCE(projection_kind,'')) LIKE '%MARKET_IMPLIED%' OR
      upper(COALESCE(engine,'')) LIKE '%PINNACLE%' OR
      upper(COALESCE(engine,'')) LIKE '%MARKET_IMPLIED%' OR
      lower(COALESCE(projection_flags,'')) LIKE '%pinnacle_implied_score%' OR
      lower(COALESCE(projection_flags,'')) LIKE '%market_implied%'
      THEN 1 ELSE 0 END`;

    const baseCte=`
      WITH eligible AS (
        SELECT
          game_id,sport,date,matchup,checkpoint,model_version,frozen_at,
          proj_home,proj_away,proj_total,proj_margin,p_home_final,data_quality,
          engine,actual_home,actual_away,graded_at,projection_kind,projection_flags,
          layers_json,pal_json,
          ${startExpr} AS event_start,
          ${modelExpr} AS model_id,
          ${marketExpr} AS market_informed,
          ROW_NUMBER() OVER (
            PARTITION BY sport,game_id,${modelExpr}
            ORDER BY frozen_at DESC
          ) AS rn,
          COUNT(*) OVER (
            PARTITION BY sport,game_id,${modelExpr}
          ) AS snapshot_count
        FROM prediction_snapshots
        WHERE date >= ?
          AND (
            ${startExpr} IS NULL OR
            frozen_at <= ${startExpr}
          )
      ),
      canonical AS (
        SELECT * FROM eligible WHERE rn=1
      )
    `;

    const [rawCounts,summaryRows,auditRows,trainingRows,findingRows,postStartRows]=await Promise.all([
      allRows(db,
        `SELECT sport,COUNT(*) AS snapshot_rows
           FROM prediction_snapshots
          WHERE date >= ?
          GROUP BY sport`,
        [since]
      ),
      allRows(db,
        baseCte+`
        SELECT
          sport,model_id,
          COUNT(*) AS projected_games,
          SUM(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL THEN 1 ELSE 0 END) AS graded_games,
          SUM(CASE WHEN actual_home IS NULL OR actual_away IS NULL THEN 1 ELSE 0 END) AS awaiting_finals,
          AVG(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL
            THEN abs(proj_margin - (actual_home-actual_away)) END) AS margin_mae,
          AVG(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL
            THEN proj_margin - (actual_home-actual_away) END) AS margin_bias,
          AVG(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL
            THEN abs(proj_total - (actual_home+actual_away)) END) AS total_mae,
          AVG(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL
            THEN proj_total - (actual_home+actual_away) END) AS total_bias,
          AVG(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL
                     AND actual_home != actual_away AND p_home_final IS NOT NULL
            THEN (p_home_final - CASE WHEN actual_home>actual_away THEN 1.0 ELSE 0.0 END) *
                 (p_home_final - CASE WHEN actual_home>actual_away THEN 1.0 ELSE 0.0 END) END) AS brier,
          AVG(CASE WHEN actual_home IS NOT NULL AND actual_away IS NOT NULL
                     AND actual_home != actual_away AND proj_margin != 0
            THEN CASE WHEN
              (proj_margin>0 AND actual_home>actual_away) OR
              (proj_margin<0 AND actual_home<actual_away)
            THEN 1.0 ELSE 0.0 END END) AS winner_hit,
          MAX(market_informed) AS market_informed,
          MAX(frozen_at) AS last_frozen_at,
          MAX(graded_at) AS last_graded_at
        FROM canonical
        GROUP BY sport,model_id
        ORDER BY sport,model_id`,
        [since]
      ),
      allRows(db,
        baseCte+`
        SELECT *
        FROM canonical
        ORDER BY date DESC,sport,matchup,model_id
        LIMIT ?`,
        [since,auditLimit]
      ),
      allRows(db,
        `SELECT model_id,method,train_until,validate_from,validate_until,n,metrics_json,leakage_ok,created_at
           FROM model_validation_runs
          WHERE method='weekly-auto-train-calibration-v1'
          ORDER BY created_at DESC`
      ),
      allRows(db,
        `SELECT sport,model_id,COUNT(*) AS open_findings
           FROM model_learning_findings
          WHERE status='OPEN'
          GROUP BY sport,model_id`
      ),
      allRows(db,
        `SELECT sport,COUNT(*) AS n
           FROM prediction_snapshots
          WHERE date >= ?
            AND ${startExpr} IS NOT NULL
            AND frozen_at > ${startExpr}
          GROUP BY sport`,
        [since]
      ),
    ]);

    const rawCountBySport=new Map(rawCounts.map(r=>[String(r.sport||"").toLowerCase(),Number(r.snapshot_rows)||0]));
    const postStartBySport=new Map(postStartRows.map(r=>[String(r.sport||"").toLowerCase(),Number(r.n)||0]));
    const findingByKey=new Map(findingRows.map(r=>[[String(r.sport||"").toLowerCase(),String(r.model_id||"")].join("|"),Number(r.open_findings)||0]));
    const trainingByModel=new Map();
    for(const row of trainingRows){
      const id=String(row.model_id||"");
      if(id && !trainingByModel.has(id)) trainingByModel.set(id,parseTrainingRow(row));
    }

    const sports=new Map(LEARNING_SPORTS.map(s=>[s,{
      sport:s.toUpperCase(),
      ok:true,
      snapshotRows:rawCountBySport.get(s)||0,
      canonicalProjections:0,
      gradedProjections:0,
      awaitingFinals:0,
      rejectedPostStart:postStartBySport.get(s)||0,
      models:[],
    }]));

    for(const row of summaryRows){
      const sport=String(row.sport||"").toLowerCase();
      if(!sports.has(sport)) continue;
      const projected=Number(row.projected_games)||0;
      const graded=Number(row.graded_games)||0;
      const awaiting=Number(row.awaiting_finals)||0;
      const id=String(row.model_id||modelId(row));
      const lastTraining=trainingByModel.get(id)||null;
      const bucket=sports.get(sport);
      bucket.canonicalProjections+=projected;
      bucket.gradedProjections+=graded;
      bucket.awaitingFinals+=awaiting;
      bucket.models.push({
        sport:sport.toUpperCase(),
        modelId:id,
        projectedGames:projected,
        gradedGames:graded,
        awaitingFinals:awaiting,
        metrics:{
          sport,
          n:graded,
          margin:{mae:finite(row.margin_mae),bias:finite(row.margin_bias)},
          total:{mae:finite(row.total_mae),bias:finite(row.total_bias)},
          probability:{brier:finite(row.brier),winnerHit:finite(row.winner_hit)},
        },
        currentTrainingPreview:{
          status:graded>=30?"READY_FOR_MONDAY":"INSUFFICIENT_DATA",
          n:graded,
          minimumN:30,
          targets:{},
        },
        lastTraining,
        openFindings:findingByKey.get([sport,id].join("|"))||0,
        marketInformed:Number(row.market_informed)===1,
        lastFrozenAt:row.last_frozen_at||null,
        lastGradedAt:row.last_graded_at||null,
      });
    }

    const audit=auditRows.map(row=>{
      const actualHome=finite(row.actual_home);
      const actualAway=finite(row.actual_away);
      const projTotal=finite(row.proj_total);
      const projMargin=finite(row.proj_margin);
      const actualTotal=actualHome!=null&&actualAway!=null?actualHome+actualAway:null;
      const actualMargin=actualHome!=null&&actualAway!=null?actualHome-actualAway:null;
      const {availabilityText,weatherText}=conditionSummary(row);
      let winnerCorrect=null;
      if(actualMargin!=null&&actualMargin!==0&&projMargin!=null&&projMargin!==0){
        winnerCorrect=(actualMargin>0)===(projMargin>0);
      }
      return {
        gameId:String(row.game_id||""),
        sport:String(row.sport||"").toUpperCase(),
        date:row.date||null,
        start:row.event_start||null,
        matchup:row.matchup||null,
        modelId:String(row.model_id||modelId(row)),
        modelVersion:row.model_version||null,
        engine:row.engine||null,
        checkpoint:row.checkpoint||null,
        snapshotCount:Number(row.snapshot_count)||1,
        frozenAt:row.frozen_at||null,
        projAway:finite(row.proj_away),
        projHome:finite(row.proj_home),
        projTotal,
        projMargin,
        pHome:finite(row.p_home_final),
        actualAway,
        actualHome,
        actualTotal,
        actualMargin,
        totalError:actualTotal!=null&&projTotal!=null?projTotal-actualTotal:null,
        marginError:actualMargin!=null&&projMargin!=null?projMargin-actualMargin:null,
        winnerCorrect,
        gradedAt:row.graded_at||null,
        projectionKind:row.projection_kind||null,
        marketInformed:Number(row.market_informed)===1||marketInformed(row),
        dataQuality:finite(row.data_quality),
        projectionFlags:row.projection_flags||null,
        weather:weatherText,
        availability:availabilityText,
        learningStatus:actualHome!=null&&actualAway!=null?"GRADED / INCLUDED":"AWAITING FINAL",
      };
    });

    const sportList=[...sports.values()];
    const totals=sportList.reduce((acc,s)=>{
      acc.snapshotRows+=s.snapshotRows;
      acc.canonicalProjections+=s.canonicalProjections;
      acc.gradedProjections+=s.gradedProjections;
      acc.awaitingFinals+=s.awaitingFinals;
      acc.rejectedPostStart+=s.rejectedPostStart;
      return acc;
    },{snapshotRows:0,canonicalProjections:0,gradedProjections:0,awaitingFinals:0,rejectedPostStart:0});

    return json({
      ok:true,
      status:"success",
      source:"prediction_snapshots",
      since,
      totals,
      sports:sportList,
      audit,
      auditTruncated:audit.length>=auditLimit,
      errors:[],
      generatedAt:new Date().toISOString(),
      note:"D1 prediction_snapshots is authoritative. Every immutable snapshot remains stored. Projection Audit exposes the latest valid pregame projection per game/model and Snapshots Stored shows how many immutable checkpoints exist for that game/model.",
    });
  }catch(err){
    return json({ok:false,status:"failed",source:"prediction_snapshots",error:String(err?.message||err),generatedAt:new Date().toISOString()},503);
  }
}
