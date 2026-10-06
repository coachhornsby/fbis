import { buildProspectiveEvidence, promotionCohortEligibility } from "./prospectiveEvidence.js";
import { buildEconomicGrade } from "./economicGrading.js";

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k, stable(x)]));
  }
  return v;
}
function j(v) { return v == null ? null : JSON.stringify(stable(v)); }
function same(a,b) { return String(a ?? "") === String(b ?? ""); }
function sameJson(stored,value) {
  if (stored == null && value == null) return true;
  try {
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return j(parsed) === j(value);
  } catch {
    return same(stored, j(value));
  }
}

export async function persistProspectiveEvidence(env, input, eligibilityOptions = {}) {
  if (!env?.DB) return { ok:false, reason:"D1-unbound" };
  const row = buildProspectiveEvidence(input);
  const cohort = promotionCohortEligibility(row, eligibilityOptions);
  const existing = await env.DB.prepare("SELECT * FROM fbis_prospective_evidence WHERE evidence_id=?").bind(row.evidenceId).first();
  if (existing) {
    const immutable = [
      ["sport",row.sport],["event_id",row.eventId],["event_start_at",row.eventStartAt],["snapshot_at",row.snapshotAt],
      ["champion_model_id",row.championModelId],["model_id",row.modelId],["model_version",row.modelVersion],
      ["lifecycle",row.lifecycle],["gate_version",row.gateVersion],["state_snapshot_id",row.stateSnapshotId],
      ["market_snapshot_id",row.marketSnapshotId],["market_observed_at",row.marketObservedAt],["code_sha",row.codeSha],
      ["legacy",row.legacy?1:0],["can_qualify",row.canQualify?1:0],["can_authorize",row.canAuthorize?1:0],
    ];
    const jsonImmutable = [
      ["incumbent_projection_json",row.incumbentProjection],["challenger_projection_json",row.challengerProjection],
      ["governance_json",row.governance],["source_observed_ats_json",row.sourceObservedAts],["state_snapshot_json",row.stateSnapshot],
      ["market_snapshot_json",row.marketSnapshot],["uncertainty_json",row.uncertainty],
      ["qualification_authority_json",row.qualificationAuthority],["wager_authority_json",row.wagerAuthority],
    ];
    const conflict = immutable.filter(([k,v])=>!same(existing[k],v)).map(([k])=>k)
      .concat(jsonImmutable.filter(([k,v])=>!sameJson(existing[k],v)).map(([k])=>k));
    if (conflict.length) return { ok:false, conflict:true, reason:"prospective-evidence-immutable-conflict", fields:conflict };
    return { ok:true, already:true, promotionEligible:Number(existing.promotion_eligible||0)===1 };
  }
  await env.DB.prepare(`INSERT INTO fbis_prospective_evidence(
    evidence_id,contract_version,sport,event_id,event_start_at,snapshot_at,champion_model_id,model_id,model_version,lifecycle,
    gate_version,state_snapshot_id,market_snapshot_id,market_observed_at,code_sha,incumbent_projection_json,challenger_projection_json,
    governance_json,temporal_integrity,legacy,can_qualify,can_authorize,source_observed_ats_json,state_snapshot_json,market_snapshot_json,
    uncertainty_json,temporal_diagnostics_json,qualification_authority_json,wager_authority_json,promotion_eligible,promotion_exclusion_reasons_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    row.evidenceId,row.version,row.sport,row.eventId,row.eventStartAt,row.snapshotAt,row.championModelId,row.modelId,row.modelVersion,row.lifecycle,
    row.gateVersion,row.stateSnapshotId,row.marketSnapshotId,row.marketObservedAt,row.codeSha,j(row.incumbentProjection),j(row.challengerProjection),
    j(row.governance),row.temporalIntegrity.ok?1:0,row.legacy?1:0,row.canQualify?1:0,row.canAuthorize?1:0,j(row.sourceObservedAts),j(row.stateSnapshot),
    j(row.marketSnapshot),j(row.uncertainty),j(row.temporalIntegrity),j(row.qualificationAuthority),j(row.wagerAuthority),cohort.eligible?1:0,j(cohort.reasons)
  ).run();
  return { ok:true, inserted:true, promotionEligible:cohort.eligible, promotionExclusionReasons:cohort.reasons };
}

export async function persistEconomicGrade(env, input) {
  if (!env?.DB) return { ok:false, reason:"D1-unbound" };
  const grade = buildEconomicGrade(input);
  const m=input.metadata||{};
  if (!m.entryMarketSnapshotId || !m.entryObservedAt || !m.economicBasis || !m.metricMethodVersion) {
    return { ok:false, reason:"economic-grade-provenance-incomplete" };
  }
  const evidence = await env.DB.prepare("SELECT evidence_id,promotion_eligible FROM fbis_prospective_evidence WHERE evidence_id=?").bind(grade.evidenceId).first();
  if (!evidence) return { ok:false, reason:"prospective-evidence-not-found" };
  const existing = await env.DB.prepare("SELECT * FROM fbis_economic_grades WHERE grade_id=?").bind(grade.gradeId).first();
  if (existing) {
    const conflict = [
      ["evidence_id",grade.evidenceId],["contract_version",grade.version],["sport",grade.sport],["event_id",grade.eventId],
      ["market_family",grade.marketFamily],["selection",grade.selection],["projected_probability",grade.projectedProbability],
      ["entry_line",grade.entryLine],["entry_price",grade.entryPrice],["entry_no_vig_probability",grade.entryNoVigProbability],
      ["close_line",grade.closeLine],["close_price",grade.closePrice],["close_no_vig_probability",grade.closeNoVigProbability],
      ["result",grade.result],["stake_units",grade.stakeUnits],["clv_probability",grade.clvProbability],["profit_units",grade.profitUnits],
      ["roi",grade.roi],["brier",grade.brier],["log_loss",grade.logLoss],["graded_at",grade.gradedAt],
    ].filter(([k,v])=>!same(existing[k],v)).map(([k])=>k);
    if (!sameJson(existing.metadata_json,grade.metadata)) conflict.push("metadata_json");
    const provenance = [
      ["entry_market_snapshot_id",m.entryMarketSnapshotId],["close_market_snapshot_id",m.closeMarketSnapshotId||null],
      ["entry_observed_at",m.entryObservedAt],["close_observed_at",m.closeObservedAt||null],
      ["economic_basis",m.economicBasis],["metric_method_version",m.metricMethodVersion],
    ];
    conflict.push(...provenance.filter(([k,v])=>!same(existing[k],v)).map(([k])=>k));
    if (conflict.length) return { ok:false, conflict:true, reason:"economic-grade-immutable-conflict", fields:conflict };
    return { ok:true, already:true };
  }
  await env.DB.prepare(`INSERT INTO fbis_economic_grades(
    grade_id,evidence_id,contract_version,sport,event_id,market_family,selection,projected_probability,entry_line,entry_price,
    entry_no_vig_probability,close_line,close_price,close_no_vig_probability,result,stake_units,clv_probability,profit_units,roi,brier,log_loss,
    graded_at,metadata_json,entry_market_snapshot_id,close_market_snapshot_id,entry_observed_at,close_observed_at,economic_basis,metric_method_version
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    grade.gradeId,grade.evidenceId,grade.version,grade.sport,grade.eventId,grade.marketFamily,grade.selection,grade.projectedProbability,
    grade.entryLine,grade.entryPrice,grade.entryNoVigProbability,grade.closeLine,grade.closePrice,grade.closeNoVigProbability,grade.result,grade.stakeUnits,
    grade.clvProbability,grade.profitUnits,grade.roi,grade.brier,grade.logLoss,grade.gradedAt,j(grade.metadata),
    m.entryMarketSnapshotId||null,m.closeMarketSnapshotId||null,m.entryObservedAt||null,m.closeObservedAt||null,m.economicBasis||null,m.metricMethodVersion||null
  ).run();
  return { ok:true, inserted:true, promotionEligible:Number(evidence.promotion_eligible||0)===1 };
}
