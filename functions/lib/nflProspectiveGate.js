import criteria from "../../data/models/nfl-qb-prospective-promotion-gate-v1.json" with { type: "json" };

function finite(v){const n=Number(v);return v==null||v===""||!Number.isFinite(n)?null:n}
function avg(rows,key){
  const a=rows.map(r=>finite(r[key])).filter(v=>v!=null);
  return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
}
function meanAbs(rows,key){
  const a=rows.map(r=>finite(r[key])).filter(v=>v!=null);
  return a.length?a.reduce((s,v)=>s+Math.abs(v),0)/a.length:null;
}
function parseJson(v,fallback=null){try{return typeof v==="string"?JSON.parse(v):v??fallback}catch{return fallback}}
function ts(v){const n=Date.parse(v||"");return Number.isFinite(n)?n:null}
function checkpointKind(v){
  const s=String(v||"").toUpperCase();
  if(s.startsWith("LATE"))return"LATE";
  if(s.startsWith("EARLY"))return"EARLY";
  return s;
}
function rowGateId(r){
  return parseJson(r?.provenance_json,{})?.prospectiveGateId||null;
}
function eligibleCohort(rows=[]){
  const start=ts(criteria.frozenAt);
  return rows.filter(r=>{
    const frozen=ts(r?.frozen_at);
    return frozen!=null && start!=null && frozen>=start && rowGateId(r)===criteria.gateId;
  });
}

export function nflQbProspectiveCriteria(){return structuredClone(criteria)}

export function nflQbTemporalViolations(rows=[]){
  const violations=[];
  for(const r of rows){
    const freeze=ts(r.frozen_at);
    if(freeze==null)continue;
    const market=parseJson(r.executable_market_json,{})||{};
    const provenance=parseJson(r.provenance_json,{})||{};
    const home=parseJson(r.home_profile_json,{})||{};
    const away=parseJson(r.away_profile_json,{})||{};
    const fields=[
      ["market.observedAt",market.observedAt],
      ["provenance.stateSourceUpdatedAt",provenance.stateSourceUpdatedAt],
      ["home.updatedAt",home.updatedAt],
      ["home.sourceUpdatedAt",home.sourceUpdatedAt],
      ["away.updatedAt",away.updatedAt],
      ["away.sourceUpdatedAt",away.sourceUpdatedAt],
    ];
    for(const [field,value] of fields){
      const t=ts(value);
      if(t!=null&&t>freeze){
        violations.push({eventId:r.event_id,checkpoint:r.checkpoint,field,value,frozenAt:r.frozen_at});
      }
    }
    for(const side of [["home",home],["away",away]]){
      for(const p of side[1]?.players||[]){
        for(const [field,value] of [["stateSourceUpdatedAt",p.stateSourceUpdatedAt],["updatedAt",p.updatedAt]]){
          const t=ts(value);
          if(t!=null&&t>freeze)violations.push({eventId:r.event_id,checkpoint:r.checkpoint,field:`${side[0]}.player.${field}`,value,frozenAt:r.frozen_at});
        }
      }
    }
  }
  return violations;
}

function primaryRows(rows=[]){
  const byEvent=new Map();
  for(const r of rows){
    const prior=byEvent.get(String(r.event_id));
    const currentKind=checkpointKind(r.checkpoint);
    const priorKind=checkpointKind(prior?.checkpoint);
    if(!prior || (priorKind!=="LATE"&&currentKind==="LATE"))byEvent.set(String(r.event_id),r);
  }
  return [...byEvent.values()];
}
function groupMetrics(rows=[]){
  if(!rows.length)return{n:0};
  const sumUnits=key=>rows.map(r=>finite(r[key])).filter(v=>v!=null).reduce((s,v)=>s+v,0);
  const clv=key=>avg(rows,key);
  return {
    n:rows.length,
    incumbent:{
      marginMae:avg(rows,"incumbent_margin_abs_error"),
      winnerAccuracy:avg(rows,"incumbent_winner_correct"),
      brier:avg(rows,"incumbent_brier"),
      logLoss:avg(rows,"incumbent_log_loss"),
      roiUnits:sumUnits("incumbent_roi_units"),
      avgClv:clv("incumbent_clv"),
    },
    challenger:{
      marginMae:avg(rows,"challenger_margin_abs_error"),
      winnerAccuracy:avg(rows,"challenger_winner_correct"),
      brier:avg(rows,"challenger_brier"),
      logLoss:avg(rows,"challenger_log_loss"),
      roiUnits:sumUnits("challenger_roi_units"),
      avgClv:clv("challenger_clv"),
    }
  };
}
function weekStats(rows=[]){
  const by=new Map();
  for(const r of rows){
    if(Number(r.gate_fired)!==1)continue;
    const key=`${r.season||""}-W${r.week||""}`;
    if(!by.has(key))by.set(key,[]);
    by.get(key).push(r);
  }
  const weeks=[];
  for(const [key,a] of by){
    if(a.length<2)continue;
    const inc=avg(a,"incumbent_margin_abs_error"),chal=avg(a,"challenger_margin_abs_error");
    weeks.push({key,n:a.length,incumbentMarginMae:inc,challengerMarginMae:chal,stable:inc!=null&&chal!=null&&chal<=inc+0.10});
  }
  return weeks;
}

export function evaluateNflQbProspectiveGate(rows=[]){
  const cohort=eligibleCohort(rows);
  const excludedRows=rows.length-cohort.length;
  const graded=primaryRows(cohort.filter(r=>r.graded_at));
  const gated=graded.filter(r=>Number(r.gate_fired)===1);
  const nonGated=graded.filter(r=>Number(r.gate_fired)!==1);
  const all=groupMetrics(graded),g=groupMetrics(gated),ng=groupMetrics(nonGated);
  const weeks=weekStats(graded),stableShare=weeks.length?weeks.filter(w=>w.stable).length/weeks.length:0;
  const seasons=new Set(gated.map(r=>Number(r.season)).filter(Number.isFinite));
  const temporal=nflQbTemporalViolations(cohort);
  const totalMismatch=cohort.filter(r=>finite(r.challenger_total)!==finite(r.incumbent_total));
  const gateOffMismatch=cohort.filter(r=>Number(r.gate_fired)!==1 && (
    finite(r.challenger_margin)!==finite(r.incumbent_margin) ||
    finite(r.challenger_win_probability)!==finite(r.incumbent_win_probability)
  ));
  const t=criteria.thresholds;
  const checks={
    minTotalGradedGames:graded.length>=t.minTotalGradedGames,
    minGateFiredGames:gated.length>=t.minGateFiredGames,
    minGateFiredWeeks:weeks.length>=t.minGateFiredWeeks,
    minDistinctSeasons:seasons.size>=t.minDistinctSeasons,
    overallMarginNonInferior:all.n>0 && all.challenger.marginMae<=all.incumbent.marginMae+t.maxOverallMarginMaeDeterioration,
    gatedMarginImproves:g.n>0 && (g.incumbent.marginMae-g.challenger.marginMae)>=t.minGatedMarginMaeImprovement,
    gatedBrierNonInferior:g.n>0 && g.challenger.brier<=g.incumbent.brier+t.maxGatedBrierDeterioration,
    gatedLogLossNonInferior:g.n>0 && g.challenger.logLoss<=g.incumbent.logLoss+t.maxGatedLogLossDeterioration,
    weekStability:weeks.length>0 && stableShare>=t.minStableWeekShare,
    temporalIntegrity:temporal.length<=t.maxTemporalIntegrityViolations,
    totalsExact:totalMismatch.length===0,
    gateOffExact:gateOffMismatch.length===0,
  };
  const researchGatePassed=Object.values(checks).every(Boolean);
  return {
    governanceId:criteria.governanceId,
    gateId:criteria.gateId,
    modelId:criteria.modelId,
    champion:criteria.champion,
    frozenAt:criteria.frozenAt,
    thresholds:criteria.thresholds,
    checks,
    researchGatePassed,
    automaticPromotion:false,
    operatorApprovalRequired:true,
    promotionEligible:false,
    sample:{eligibleFrozenRows:cohort.length,excludedPreGateOrWrongVersionRows:excludedRows,graded:graded.length,gated:gated.length,nonGated:nonGated.length,gateFiredWeeks:weeks.length,distinctSeasons:seasons.size},
    metrics:{all,gated:g,nonGated:ng,stableWeekShare:stableShare,weeks},
    integrity:{temporalViolations:temporal,totalMismatches:totalMismatch.length,gateOffMismatches:gateOffMismatch.length},
    decision:researchGatePassed
      ?"RESEARCH_GATE_PASSED_OPERATOR_APPROVAL_STILL_REQUIRED"
      :"PROSPECTIVE_SHADOW_ACCUMULATING",
  };
}
