/** Tennis source-rights firewall: authorization is field-specific and explicit.
 * MIT code licenses do not confer rights to data scraped by that code.
 */
const DENIED=new Set([
 'SACKMANN','TENNIS_ABSTRACT','SOFASCORE','TENNISEXPLORER',
 'MATCHSTAT_UNVERIFIED','ATP_WEBSITE_UNLICENSED','WTA_WEBSITE_UNLICENSED',
 'GITHUB_THIRD_PARTY_DATA','UNKNOWN'
]);
export function assessTennisSourceAdmission(input={}){
 const reasons=[];
 const str=x=>String(x||'').trim().toUpperCase();
 const origin=str(input.origin);
 const terms=str(input.underlyingDataLicense);
 if(!origin||DENIED.has(origin))reasons.push('SOURCE_NOT_APPROVED');
 if(/BY-NC|NONCOMMERCIAL|RESEARCH.ONLY/.test(terms))reasons.push('NONCOMMERCIAL_DATA_RIGHTS');
 if(input.commercialBettingPermitted!==true)reasons.push('COMMERCIAL_BETTING_RIGHTS_UNVERIFIED');
 if(input.systematicRetrievalPermitted!==true)reasons.push('SYSTEMATIC_COLLECTION_RIGHTS_UNVERIFIED');
 if(input.longTermStoragePermitted!==true)reasons.push('HISTORICAL_STORAGE_RIGHTS_UNVERIFIED');
 if(input.approvalEvidenceArchived!==true)reasons.push('SOURCE_APPROVAL_EVIDENCE_MISSING');
 if(!input.stableSourceId||!input.observedAt||!Number.isFinite(Date.parse(input.observedAt)))
   reasons.push('IDENTITY_OR_OBSERVATION_TIME_MISSING');
 if(input.declaredSource&&str(input.declaredSource)!==origin)reasons.push('SOURCE_LABEL_CONFLICT');
 return {admitted:reasons.length===0,reasons,origin:origin||'UNKNOWN',
  canTrainCommercialModel:reasons.length===0,
  // Separate from rights: wagering requires prospective qualification and release authorization.
  canAuthorizeWager:false};
}
