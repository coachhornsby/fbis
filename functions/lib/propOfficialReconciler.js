import { readPropEvidence, persistPropEvidence } from './propEvidenceStore.js';
import { gradeOfficialProp } from './propOfficialSettlement.js';

/**
 * Evidence-driven research reconciliation. Only reads existing content-addressed
 * snapshots; a caller cannot provide arbitrary projections, outcomes or grades.
 * Source certification, contract rule verification and initial capture belong to
 * independently governed ingestion jobs, NOT this module.
 */
export async function reconcileOfficialProp(env, {
 projectionId, marketId, resultId, observedAt,
 webCrypto = globalThis.crypto
} = {}) {
 const blocked = (reason, details = null) => ({
  ok:false,status:'BLOCKED',reason,details,canQualify:false,canAuthorizeWager:false
 });
 if (![projectionId,marketId,resultId].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))
  return blocked('EXACT_EVIDENCE_IDS_REQUIRED');
 const kinds = [['FROZEN_PROJECTION',projectionId],['MARKET_SNAPSHOT',marketId],['OFFICIAL_RESULT',resultId]];
 const reads = [];
 for (const [kind,id] of kinds) {
  const r=await readPropEvidence(env,kind,id,{webCrypto});
  if (!r.ok) return blocked('EVIDENCE_READ_FAILED',{kind,reason:r.reason});
  reads.push(r.payload);
 }
 const [predictionPayload,contractPayload,resultPayload]=reads;
 const validLink = reads.every(x=>x.schemaVersion===1&&x.canonicalEventId===predictionPayload.canonicalEventId&&x.canonicalPlayerId===predictionPayload.canonicalPlayerId);
 if(!validLink)return blocked('EVIDENCE_IDENTITY_MISMATCH');
 // Prevent trusting post-event market captures as contemporaneous snapshots.
 const capture=Date.parse(contractPayload.observedAt),start=Date.parse(contractPayload.contract?.eventStart);
 const frozen=Date.parse(predictionPayload.prediction?.frozenAt);
 if(!Number.isFinite(capture)||!Number.isFinite(start)||!Number.isFinite(frozen)||capture>=start||frozen>=start)
  return blocked('PREGAME_TEMPORAL_EVIDENCE_REQUIRED');
 // Event/contract-scoped provider rules must be certified by a separate source adapter.
 if(contractPayload.settlementPolicyVerified!==true||contractPayload.settlementPolicySourceId==null)
  return blocked('INDEPENDENT_SETTLEMENT_POLICY_REQUIRED');
 const grade=gradeOfficialProp({
  prediction:predictionPayload.prediction,
  contract:contractPayload.contract,
  result:resultPayload.result
 });
 if(!grade.supported)return blocked('GRADING_EVIDENCE_INSUFFICIENT',grade.reasons);
 const timestamp=Date.parse(observedAt);
 const resultTime=Date.parse(resultPayload.result.finalizedAt);
 if(!Number.isFinite(timestamp)||timestamp<resultTime)return blocked('GRADE_TIMESTAMP_INVALID');
 const stored={
  schemaVersion:1,kind:'SETTLEMENT_GRADE',observedAt:new Date(timestamp).toISOString(),
  canonicalEventId:predictionPayload.canonicalEventId,canonicalPlayerId:predictionPayload.canonicalPlayerId,
  sourceId:'fbis:prop-reconciler:v1',projectionEvidenceId:projectionId,marketEvidenceId:marketId,
  resultEvidenceId:resultId,grade,recordedWager:false,canQualify:false,canAuthorizeWager:false
 };
 const write=await persistPropEvidence(env,stored,{webCrypto});
 if(!write.ok)return blocked('GRADE_PERSISTENCE_FAILED',write.reason);
 return {ok:true,status:'GRADED_RESEARCH_ONLY',gradeEvidenceId:write.id,alreadyPersisted:write.existed,
  grade:grade.grade,recordedWager:false,canQualify:false,canAuthorizeWager:false};
}
