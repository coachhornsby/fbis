// Source-evidence triage only. Never mutates canonical identities or betting profiles.
// Inputs come from the authenticated, noncommercial Tennis research audit.
export const RELEASE_POLICY = Object.freeze({
  scope:'PRIVATE_NONCOMMERCIAL_RESEARCH_ONLY', canQualify:false,
  canAuthorizeWager:false, productionWrites:0, identityUpdates:0
});
const allowed = new Set(['CANONICAL_BIOGRAPHY_MISSING','MULTIPLE_SOURCE_IDS',
  'COUNTRY_CONFLICT','BIRTHDATE_CONFLICT','SOURCE_BIOGRAPHY_MISSING',
  'MASTER_SOURCE_ID_COLLISION','MASTER_NAME_MISMATCH','SOURCE_MASTER_ID_MISSING',
  'NO_SOURCE_ID']);
export function adjudicateResearchReport(report){
 if(!report||report.targets!==520||report.sourceLicense!=='CC BY-NC-SA 4.0'||
   report.researchIntegrity?.noCrossTierPooling!==true||
   report.researchIntegrity?.sourceMastersVerified!==2||
   report.researchIntegrity?.statisticalSourcesVerified!==9||
   report.productionWrites!==0||report.canAuthorizeWager!==false||
   report.players?.length!==520)throw Error('RESEARCH_EVIDENCE_RECEIPT_INCOMPLETE');
 const seen=new Set(), review=[], corroborated=[], counts={atp:0,wta:0};
 for(const p of report.players){
  if(!['atp','wta'].includes(p.tour))throw Error('UNKNOWN_TOUR');
  const key=p.tour+'|'+p.playerKey;
  if(seen.has(key))throw Error('DUPLICATE_CANONICAL_PLAYER');
  seen.add(key);counts[p.tour]++;
  if(p.canQualify!==false||p.canAuthorizeWager!==false||
    p.researchProfileUsage!=='PRIVATE_NONCOMMERCIAL_RESEARCH_ONLY'||
    p.researchTierProfiles?.some(t=>t.projectionAuthority!==false||
      t.competitionAdjustment!=='NOT_ESTIMATED'||t.modelEligibility!=='NOT_QUALIFIED'))
    throw Error('RESEARCH_ONLY_INVARIANT_VIOLATED');
  const identity=p.identityResearch;
  if(!identity||identity.canAutoLink!==false||identity.canQualify!==false||
    identity.canAuthorizeWager!==false)throw Error('IDENTITY_FAIL_CLOSED_VIOLATION');
  const surfaces=Object.fromEntries(['hard','clay','grass'].map(s=>[
    s,p.researchTierProfiles?.filter(t=>t.surface===s).reduce((n,t)=>n+t.validMatches,0)||0
  ]));
  const candidate={tour:p.tour,playerKey:p.playerKey,playerName:p.playerName,
    candidateSourceIds:p.candidateSourceIds,reason:identity.reason,
    validResearchMatches:p.validServeMatches,usableResearchSurfaceSamples:surfaces,
    researchOnly:true,productionQualified:false};
  if(identity.reason===null){
   if(identity.identityEvidence!=='SOURCE_ID_NAME_DOB_COUNTRY_CONCORDANT'||
     p.candidateSourceIds?.length!==1)throw Error('CORROBORATION_RECEIPT_INVALID');
   corroborated.push(candidate);
  }else{
   if(!allowed.has(identity.reason))throw Error('UNKNOWN_IDENTITY_BLOCKER');
   const priority=identity.reason==='MULTIPLE_SOURCE_IDS'||identity.reason==='BIRTHDATE_CONFLICT'?'CRITICAL_REVIEW':
     identity.reason==='COUNTRY_CONFLICT'?'REVIEW_CONFLICT':
     'NEEDS_INDEPENDENT_BIOGRAPHY';
   review.push({...candidate,priority,manualResolutionRequired:true});
  }
 }
 if(counts.atp!==302||counts.wta!==218)throw Error('FROZEN_TARGET_COUNTS_CHANGED');
 if(review.length+corroborated.length!==520)throw Error('INCOMPLETE_TRIAGE');
 const reasons={};
 for(const x of review)reasons[x.reason]=(reasons[x.reason]||0)+1;
 return {generatedAt:new Date().toISOString(),inputAsOf:report.asOf,
  identityCorroboratedResearchOnly:corroborated.length,unresolvedReview:review.length,
  conflictsByReason:reasons,byTour:counts,releasePolicy:RELEASE_POLICY,
  review,corroborated,
  nextRequiredEvidence:[
    'Independently verify source ID against an authorized source and canonical biography',
    'Resolve date-of-birth and country disagreements without name-only overrides',
    'Establish intended-use rights independently of noncommercial Sackmann archive',
    'Prospective tier/surface walk-forward calibration before CORE profile consideration'
  ]};
}
