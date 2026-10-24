import test from 'node:test';
import assert from 'node:assert/strict';
import {assessTennisSourceAdmission} from '../functions/lib/tennisSourceAdmission.js';
const cleared={origin:'LICENSED_ATP_PROVIDER',declaredSource:'LICENSED_ATP_PROVIDER',
 underlyingDataLicense:'CONTRACT_REVIEWED',commercialBettingPermitted:true,
 systematicRetrievalPermitted:true,longTermStoragePermitted:true,
 approvalEvidenceArchived:true,stableSourceId:'match-123',
 observedAt:'2026-10-23T12:00:00Z'};
test('scraper software license never establishes underlying data permission',()=>{
 for(const origin of ['SACKMANN','TENNIS_ABSTRACT','SOFASCORE','TENNISEXPLORER',
  'GITHUB_THIRD_PARTY_DATA','UNKNOWN'])
  assert.equal(assessTennisSourceAdmission({...cleared,origin,declaredSource:origin}).admitted,false);
 assert.equal(assessTennisSourceAdmission({...cleared,origin:'SACKMANN',
  declaredSource:'SACKMANN',underlyingDataLicense:'CC BY-NC-SA 4.0'}).admitted,false);
});
test('explicit rights evidence required separately for data reuse',()=>{
 assert.equal(assessTennisSourceAdmission(cleared).admitted,true);
 assert.equal(assessTennisSourceAdmission(cleared).canAuthorizeWager,false);
 for(const field of ['commercialBettingPermitted','systematicRetrievalPermitted',
 'longTermStoragePermitted','approvalEvidenceArchived'])
  assert.equal(assessTennisSourceAdmission({...cleared,[field]:false}).admitted,false);
 assert.equal(assessTennisSourceAdmission({...cleared,declaredSource:'OTHER'}).admitted,false);
});
