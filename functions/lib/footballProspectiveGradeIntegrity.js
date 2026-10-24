/**
 * Audit the immutable prospective result ledger against newer SDV revisions.
 * Never rewrite a grade to match newer evidence: inconsistencies fail closed.
 */
const ms=x=>typeof x==="string"?Date.parse(x):NaN;
export function evaluateProspectiveGradeIntegrity(rows,{sport,asOf,maximum=2000}={}){
 if(!["nfl","cfb"].includes(sport)||!Number.isFinite(ms(asOf))||
   !Number.isInteger(maximum)||maximum<1)throw Error("INVALID_GRADE_INTEGRITY_SCOPE");
 if(!Array.isArray(rows)||rows.length>maximum)throw Error("GRADE_INTEGRITY_ROWS_EXCEED_LIMIT");
 const incidents=[],physical=new Set();
 for(const r of rows){
  const errors=[];
  if(r.sport!==sport||typeof r.receiptId!=="string"||!r.receiptId||
    typeof r.sourceFingerprint!=="string"||!/^[0-9a-f]{64}$/i.test(r.sourceFingerprint))
    errors.push("IDENTITY_OR_FINGERPRINT_INVALID");
  const times=[r.capturedAt,r.kickoff,r.observedAt,r.gradedAt].map(ms);
  if(!times.every(Number.isFinite)||
    !(times[0]<times[1]&&times[1]<times[2]&&times[2]<=times[3]&&times[3]<=ms(asOf)))
    errors.push("GRADING_CHRONOLOGY_INVALID");
  if(r.authority!==0||r.receiptAuthority!==0||r.regulationOnly!==1)
    errors.push("WAGER_OR_REGULATION_AUTHORITY_INVALID");
  if(!Number.isInteger(r.originalSourceCount)||r.originalSourceCount!==1)
    errors.push("ORIGINAL_SOURCE_PROVENANCE_MISSING");
  if(!Number.isInteger(r.disagreeingSourceCount)||r.disagreeingSourceCount>0)
    errors.push("NEW_VERIFIED_SCORE_CONFLICT");
  if(!Number.isInteger(r.actualHome)||!Number.isInteger(r.actualAway)||
    r.actualHome<0||r.actualAway<0)errors.push("OFFICIAL_RESULT_INVALID");
  if(errors.length)incidents.push({receiptId:r.receiptId,errors});
  physical.add([r.homeTeamId,r.awayTeamId,r.kickoff].join("|"));
 }
 const classifications={};
 for(const i of incidents)for(const e of i.errors)classifications[e]=(classifications[e]||0)+1;
 return {sport,checked:rows.length,distinctGameKickoffs:physical.size,
  incidentCount:incidents.length,classifications,incidents:incidents.slice(0,25),
  status:incidents.length===0?"CONSISTENT_WITH_VERIFIED_SOURCE":"INTEGRITY_VIOLATION",
  prospectiveProof:"SOURCE_OBSERVED_AFTER_PREGAME_KICKOFF",
  calibrated:false,canQualify:false,canAuthorizeWager:false};
}
