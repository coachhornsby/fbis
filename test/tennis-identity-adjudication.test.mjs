import test from 'node:test';
import assert from 'node:assert/strict';
import {adjudicateResearchReport} from '../scripts/lib/tennis-identity-adjudication.mjs';
const make=(tour,i,reason)=>({tour,playerKey:tour+'-'+i,playerName:tour+' '+i,
 candidateSourceIds:[String(i)],validServeMatches:4,
 researchProfileUsage:'PRIVATE_NONCOMMERCIAL_RESEARCH_ONLY',
 canQualify:false,canAuthorizeWager:false,researchTierProfiles:[{
 surface:'hard',validMatches:4,projectionAuthority:false,
 competitionAdjustment:'NOT_ESTIMATED',modelEligibility:'NOT_QUALIFIED'
 }],
 identityResearch:{reason,identityEvidence:reason===null?'SOURCE_ID_NAME_DOB_COUNTRY_CONCORDANT':'UNVERIFIED',
 canAutoLink:false,canQualify:false,canAuthorizeWager:false}});
const sample=()=>({
 targets:520,sourceLicense:'CC BY-NC-SA 4.0',productionWrites:0,canAuthorizeWager:false,
 researchIntegrity:{noCrossTierPooling:true,sourceMastersVerified:2,statisticalSourcesVerified:9},
 players:[...Array.from({length:302},(_,i)=>make('atp',i,'CANONICAL_BIOGRAPHY_MISSING')),
 ...Array.from({length:218},(_,i)=>make('wta',i,i<200?null:'COUNTRY_CONFLICT'))]
});
test('identity review is complete and cannot authorize wagering',()=>{
 const result=adjudicateResearchReport(sample());
 assert.equal(result.unresolvedReview,320);
 assert.equal(result.identityCorroboratedResearchOnly,200);
 assert.equal(result.releasePolicy.productionWrites,0);
 assert.equal(result.releasePolicy.canAuthorizeWager,false);
 assert.equal(result.review.length,320);
 assert.equal(result.review.every(x=>x.manualResolutionRequired),true);
});
test('rejects changed cohort and unknown/unapproved identity state',()=>{
 const x=sample();x.players.pop();
 assert.throws(()=>adjudicateResearchReport(x),/RESEARCH_EVIDENCE_RECEIPT_INCOMPLETE/);
 const y=sample();y.players[0].identityResearch.reason='REVIEW_APPROVED';
 assert.throws(()=>adjudicateResearchReport(y),/UNKNOWN_IDENTITY_BLOCKER/);
 const z=sample();z.players[0].canAuthorizeWager=true;
 assert.throws(()=>adjudicateResearchReport(z),/RESEARCH_ONLY_INVARIANT_VIOLATED/);
 const k=sample();k.players[0].researchTierProfiles[0].competitionAdjustment='ESTIMATED';
 assert.throws(()=>adjudicateResearchReport(k),/RESEARCH_ONLY_INVARIANT_VIOLATED/);
});
