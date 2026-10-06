import { evaluateNflQbProspectiveGate, nflQbProspectiveCriteria } from "../lib/nflProspectiveGate.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
function finite(v){const n=Number(v);return v==null||v===""||!Number.isFinite(n)?null:n}
function latestByMarket(rows=[]){
  const out=new Map();
  for(const r of rows){
    const key=String(r.market||"").toLowerCase();
    const prior=out.get(key);
    if(!prior || Date.parse(r.evaluated_at||0)>Date.parse(prior.evaluated_at||0))out.set(key,r);
  }
  return out;
}
function marketState(cal={},pros={}){
  if(!cal?.evaluated_at)return"UNCALIBRATED";
  if(Number(cal.validated)!==1)return"CALIBRATION_RESEARCH";
  if(Number(pros.graded||0)<=0)return"PROSPECTIVE_VALIDATION";
  return"PROSPECTIVE_VALIDATION";
}
const MARKETS=["passing_yards","passing_attempts","completions","receiving_yards","receptions","rushing_yards"];

export async function onRequest(context){
  if(!context.env?.DB)return json({ok:false,error:"database-unavailable"},503);
  try{
    const [shadowQ,calQ,snapQ,gradedPropQ]=await Promise.all([
      context.env.DB.prepare("SELECT * FROM nfl_qb_personnel_shadow_predictions ORDER BY start_time").all(),
      context.env.DB.prepare("SELECT * FROM nfl_prop_market_calibration_runs ORDER BY evaluated_at DESC").all(),
      context.env.DB.prepare(`
        SELECT market,
          COUNT(*) snapshots,
          SUM(CASE WHEN state_source IS NOT NULL AND state_source_updated_at IS NOT NULL
                    AND player_profile_updated_at IS NOT NULL AND line_observed_at IS NOT NULL
                   THEN 1 ELSE 0 END) state_complete,
          MAX(collected_at) latest
        FROM nfl_prop_state_snapshots
        GROUP BY market
      `).all(),
      context.env.DB.prepare(`
        SELECT s.market,
          COUNT(*) graded,
          SUM(CASE WHEN l.hit=1 THEN 1 ELSE 0 END) wins,
          AVG(CASE WHEN l.hit IS NOT NULL THEN l.hit END) hit_rate,
          AVG(l.absolute_error) mae,
          AVG(l.line_clv) avg_clv
        FROM nfl_prop_state_snapshots s
        JOIN player_prop_legs l ON l.source_line_id=s.prop_line_id
        WHERE l.actual IS NOT NULL
        GROUP BY s.market
      `).all(),
    ]);
    const shadowRows=shadowQ?.results||[];
    const gate=evaluateNflQbProspectiveGate(shadowRows);
    const frozenGames=new Set(shadowRows.map(r=>String(r.event_id))).size;
    const gateFiredGames=new Set(shadowRows.filter(r=>Number(r.gate_fired)===1).map(r=>String(r.event_id))).size;
    const gradedGames=new Set(shadowRows.filter(r=>r.graded_at).map(r=>String(r.event_id))).size;

    const cal=latestByMarket(calQ?.results||[]);
    const snaps=new Map((snapQ?.results||[]).map(r=>[String(r.market||"").toLowerCase(),r]));
    const graded=new Map((gradedPropQ?.results||[]).map(r=>[String(r.market||"").toLowerCase(),r]));
    const markets=MARKETS.map(m=>{
      const c=cal.get(m)||{},s=snaps.get(m)||{},g=graded.get(m)||{};
      const status=marketState(c,g);
      return{
        market:m,
        status,
        historicalN:Number(c.sample_size||0),
        walkForwardN:Number(c.walk_forward_n||0),
        prospectiveLineSnapshots:Number(s.snapshots||0),
        prospectiveStateCompleteSnapshots:Number(s.state_complete||0),
        gradedProspectiveProps:Number(g.graded||0),
        prospectiveHitRate:finite(g.hit_rate),
        prospectiveMae:finite(g.mae),
        prospectiveClv:finite(g.avg_clv),
        monotonic:Boolean(Number(c.monotonic||0)),
        brier:finite(c.calibrated_brier),
        logLoss:finite(c.calibrated_log_loss),
        ece:finite(c.calibrated_ece),
        validationReason:c.validation_reason||"no_calibration_run",
        premiumStarEligible:Boolean(Number(c.validated||0)===1 && status==="PREMIUM_CONFIDENCE_ELIGIBLE"),
        maxStars:Number(c.validated||0)===1 && status==="PREMIUM_CONFIDENCE_ELIGIBLE"?5:3,
        latestCalibrationAt:c.evaluated_at||null,
      };
    });

    return json({
      ok:true,
      generatedAt:new Date().toISOString(),
      nfl:{
        champion:"NFL-PRO-v1.1",
        challenger:"NFL-QB-PERSONNEL-OVERLAY-v1",
        lifecycle:"SHADOW",
        qualification:false,
        wagerAuthorization:false,
        totalsOverlay:false,
      },
      qbShadow:{
        frozenRows:shadowRows.length,
        frozenGames,
        gateFiredGames,
        gradedGames,
        gateThreshold:0.30,
        promotionGate:gate,
      },
      props:{
        starCap:3,
        premiumConfidenceBlocked:markets.every(m=>!m.premiumStarEligible),
        markets,
      },
      invariants:{
        stateBeforeWeight:true,
        calibrationBeforeStars:true,
        noGenericNflInjuryAdjustment:true,
        noGenericSnapMultiplier:true,
        noAutomaticPromotion:true,
      }
    });
  }catch(err){
    return json({ok:false,error:"nfl-research-status-failed",detail:String(err?.message||err)},500);
  }
}
