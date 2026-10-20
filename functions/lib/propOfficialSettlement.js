/**
 * Pure, fail-closed grading of a frozen prop observation against an official result.
 * This is research evidence only: it cannot create a wager or authorize execution.
 * No source row or request parameter may silently define the settlement rules.
 */
const requiredString = x => typeof x === 'string' && x.trim().length > 0;
const amount = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const same = (a,b,k) => requiredString(a[k]) && a[k] === b[k];
export function gradeOfficialProp({prediction,contract,result}={}) {
 const reasons=[];
 if(!prediction||!contract||!result)return blocked(['EVIDENCE_MISSING']);
 for(const k of ['canonicalEventId','canonicalPlayerId','canonical_market','period']) {
  if(!same(prediction,contract,k)||!same(contract,result,k))reasons.push('IDENTITY_MISMATCH:'+k);
 }
 if(!requiredString(contract.contractId)||!requiredString(contract.provider)||!requiredString(prediction.modelVersion))reasons.push('PROVENANCE_MISSING');
 if(contract.identityVerified!==true||contract.settlementVerified!==true||!requiredString(contract.settlementTerms))reasons.push('SETTLEMENT_SCOPE_UNVERIFIED');
 if(result.official!==true||!requiredString(result.source)||!requiredString(result.sourceRecordId)||!requiredString(result.finalizedAt))reasons.push('OFFICIAL_RESULT_UNVERIFIED');
 if(result.status!=='FINAL'||result.correctionPending===true)reasons.push('RESULT_NOT_FINAL');
 if(result.playerStatus!=='PLAYED')reasons.push('PLAYER_PARTICIPATION_UNRESOLVED');
 const line=amount(contract.line),actual=amount(result.actual);
 if(line===null||actual===null)reasons.push('NUMERIC_STAT_OR_LINE_MISSING');
 if(!['over','under'].includes(contract.statSide))reasons.push('STAT_SIDE_UNKNOWN');
 // Contract-specific DNP, void, OT, and push semantics require an explicit approved rule.
 if(contract.settlementRuleVersion!=='numeric-v1'||contract.voidOnDnp!==true||contract.pushOnTie!==true||contract.overtimeIncluded!==true||result.overtimeIncluded!==true)reasons.push('RULE_VERSION_UNVERIFIED');
 const frozen=Date.parse(prediction.frozenAt),event=Date.parse(contract.eventStart),final=Date.parse(result.finalizedAt);
 if(!Number.isFinite(frozen)||!Number.isFinite(event)||!Number.isFinite(final)||frozen>=event||final<event)reasons.push('TEMPORAL_INTEGRITY_FAILED');
 if(prediction.canonicalEventId!==result.canonicalEventId||prediction.canonicalPlayerId!==result.canonicalPlayerId)reasons.push('FROZEN_IDENTITY_MISMATCH');
 if(reasons.length)return blocked([...new Set(reasons)]);
 const cmp=actual>line?1:actual<line?-1:0;
 const grade=cmp===0?'PUSH':((contract.statSide==='over' ? cmp>0:cmp<0)?'WIN':'LOSS');
 return {supported:true,grade,actual,line,source:result.source,sourceRecordId:result.sourceRecordId,
  finalizedAt:result.finalizedAt,modelVersion:prediction.modelVersion,contractId:contract.contractId,
  reasons:[],recordedWager:false,canQualify:false,canAuthorizeWager:false};
}
function blocked(reasons){return {supported:false,grade:null,actual:null,line:null,reasons,recordedWager:false,canQualify:false,canAuthorizeWager:false};}
