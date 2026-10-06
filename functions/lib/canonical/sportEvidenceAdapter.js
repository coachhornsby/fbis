import { sha256Hex } from "../sha256Hex.js";
import {
  buildProspectiveEvidence,
  promotionCohortEligibility,
  PROSPECTIVE_EVIDENCE_VERSION,
  PROSPECTIVE_LIFECYCLE,
} from "./prospectiveEvidence.js";
import {
  buildEconomicGrade,
  ECONOMIC_GRADE_VERSION,
  noVigPair,
} from "./economicGrading.js";

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function json(v) {
  return JSON.stringify(v ?? null);
}

export function canonicalEvidenceId({ sport, sourceTable, sourceId, gateVersion = null }) {
  return `pe_${sha256Hex([sport, sourceTable, sourceId, gateVersion || ""].join("|"))}`;
}

export function canonicalGradeId({ evidenceId, marketFamily, selection, gradeVersion = ECONOMIC_GRADE_VERSION }) {
  return `eg_${sha256Hex([evidenceId, marketFamily, selection, gradeVersion].join("|"))}`;
}

export async function persistCanonicalProspectiveEvidence(db, input, {
  sourceTable,
  sourceId,
  cohortGateVersion = null,
  minSnapshotAt = null,
} = {}) {
  if (!db?.prepare) return { ok:false, written:0, reason:"d1_unavailable" };
  if (!sourceTable || !sourceId) return { ok:false, written:0, reason:"source_identity_required" };

  const evidenceId = input.evidenceId || canonicalEvidenceId({
    sport: input.sport,
    sourceTable,
    sourceId,
    gateVersion: input.gateVersion || cohortGateVersion,
  });

  const evidence = buildProspectiveEvidence({ ...input, evidenceId });
  const cohort = promotionCohortEligibility(evidence, {
    gateVersion: cohortGateVersion || input.gateVersion || null,
    minSnapshotAt,
    acceptedLifecycle: [
      PROSPECTIVE_LIFECYCLE.SHADOW,
      PROSPECTIVE_LIFECYCLE.PROMOTION_CANDIDATE,
      PROSPECTIVE_LIFECYCLE.CONTEXT_ONLY,
    ],
  });

  if (!evidence.temporalIntegrity.ok) {
    return { ok:false, written:0, evidence, cohort, reason:"temporal_integrity_failed" };
  }

  const governance = {
    ...(evidence.governance || {}),
    sourceTable,
    sourceId:String(sourceId),
    promotionCohortEligible:cohort.eligible,
    promotionCohortReasons:cohort.reasons,
  };

  const result = await db.prepare(`
    INSERT OR IGNORE INTO fbis_prospective_evidence(
      evidence_id,contract_version,sport,event_id,event_start_at,snapshot_at,
      champion_model_id,model_id,model_version,lifecycle,gate_version,
      state_snapshot_id,market_snapshot_id,market_observed_at,code_sha,
      incumbent_projection_json,challenger_projection_json,governance_json,
      temporal_integrity,legacy,can_qualify,can_authorize,graded_at,result_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    evidence.evidenceId,PROSPECTIVE_EVIDENCE_VERSION,evidence.sport,evidence.eventId,
    evidence.eventStartAt,evidence.snapshotAt,evidence.championModelId,evidence.modelId,
    evidence.modelVersion,evidence.lifecycle,evidence.gateVersion,evidence.stateSnapshotId,
    evidence.marketSnapshotId,evidence.marketObservedAt,evidence.codeSha,
    json(evidence.incumbentProjection),json(evidence.challengerProjection),json(governance),
    1,evidence.legacy?1:0,evidence.canQualify?1:0,evidence.canAuthorize?1:0,null,null
  ).run();

  return {
    ok:true,
    written:Number(result?.meta?.changes||0),
    existing:Number(result?.meta?.changes||0) ? 0 : 1,
    evidence:{...evidence,governance},
    cohort,
  };
}

export async function markCanonicalEvidenceGraded(db, evidenceId, {
  gradedAt,
  result = {},
} = {}) {
  if (!db?.prepare || !evidenceId) return { ok:false, updated:0 };
  const r = await db.prepare(`
    UPDATE fbis_prospective_evidence
    SET graded_at=?, result_json=?
    WHERE evidence_id=?
  `).bind(gradedAt || new Date().toISOString(), json(result), evidenceId).run();
  return { ok:true, updated:Number(r?.meta?.changes||0) };
}

export async function persistCanonicalEconomicGrade(db, input, {
  executionEvidence = false,
  sourceMetrics = {},
  sourceTable = null,
  sourceId = null,
} = {}) {
  if (!db?.prepare) return { ok:false, written:0, reason:"d1_unavailable" };

  const gradeId = input.gradeId || canonicalGradeId({
    evidenceId:input.evidenceId,
    marketFamily:input.marketFamily,
    selection:input.selection,
  });

  // Profit/ROI are reserved for real execution evidence. Research-only market
  // observations may still carry calibration and probability-CLV diagnostics.
  const grade = buildEconomicGrade({
    ...input,
    gradeId,
    entryPrice: executionEvidence ? input.entryPrice : null,
    stakeUnits: executionEvidence ? input.stakeUnits : null,
    metadata:{
      ...(input.metadata||{}),
      executionEvidence:Boolean(executionEvidence),
      sourceTable,
      sourceId:sourceId == null ? null : String(sourceId),
      sourceMetrics,
    },
  });

  const r = await db.prepare(`
    INSERT OR REPLACE INTO fbis_economic_grades(
      grade_id,evidence_id,contract_version,sport,event_id,market_family,selection,
      projected_probability,entry_line,entry_price,entry_no_vig_probability,
      close_line,close_price,close_no_vig_probability,result,clv_probability,
      profit_units,roi,brier,log_loss,graded_at,metadata_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    grade.gradeId,grade.evidenceId,ECONOMIC_GRADE_VERSION,grade.sport,grade.eventId,
    grade.marketFamily,grade.selection,grade.projectedProbability,grade.entryLine,
    grade.entryPrice,grade.entryNoVigProbability,grade.closeLine,grade.closePrice,
    grade.closeNoVigProbability,grade.result,grade.clvProbability,grade.profitUnits,
    grade.roi,grade.brier,grade.logLoss,grade.gradedAt,json(grade.metadata)
  ).run();

  return { ok:true, written:Number(r?.meta?.changes||0), grade };
}

export function twoWayNoVigFromPrices(priceA, priceB) {
  const pair = noVigPair(priceA, priceB);
  return {
    a:finite(pair.a),
    b:finite(pair.b),
    vig:finite(pair.vig),
  };
}

export function canonicalAdapterReconciliation({
  sourceCount = 0,
  canonicalCount = 0,
  duplicates = 0,
  excluded = 0,
  temporalFailures = 0,
} = {}) {
  const expected = Math.max(0, Number(sourceCount||0) - Number(excluded||0));
  return {
    sourceCount:Number(sourceCount||0),
    canonicalCount:Number(canonicalCount||0),
    expectedCanonicalCount:expected,
    excluded:Number(excluded||0),
    duplicates:Number(duplicates||0),
    temporalFailures:Number(temporalFailures||0),
    exact: Number(canonicalCount||0) === expected && Number(duplicates||0) === 0 && Number(temporalFailures||0) === 0,
  };
}
