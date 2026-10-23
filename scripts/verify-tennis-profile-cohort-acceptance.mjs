// Read-only post-refresh acceptance proof for the frozen Tennis cohort.
// Never equate presence of a surface profile with validated source statistics.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.BASE||'https://fbis-myz.pages.dev';
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('HARVEST_SECRET_REQUIRED');
const response=await fetch(base+'/api/tennis-profile-reconciliation?limit=1',{
 headers:{'x-harvest-secret':secret},signal:AbortSignal.timeout(90000)
});
assert.equal(response.status,200,'PROFILE_RECONCILIATION_ENDPOINT_UNAVAILABLE');
const j=await response.json();
assert.equal(j.ok,true,'COHORT_RECONCILIATION_UNVERIFIED');
assert.equal(j.canAuthorizeWager,false,'WAGER_AUTHORITY_CHANGED');
assert.equal(j.profilesManufactured,0,'MANUFACTURED_PROFILES');
assert.equal(j.identityUpdatesPerformed,0,'AUTO_IDENTITY_UPDATES');
const byTour=j.byTour||[];
assert.equal(byTour.length,2,'TOUR_COUNT_MISMATCH');
const counts=Object.fromEntries(byTour.map(x=>[x.tour,x]));
assert.equal(Number(counts.atp?.roster),559,'ATP_ROSTER_DRIFT');
assert.equal(Number(counts.wta?.roster),515,'WTA_ROSTER_DRIFT');
const result={verifiedAt:new Date().toISOString(),source:'live-authenticated-tennis-profile-reconciliation',
  cohortId:j.cohortId,byTour,completeTotal:byTour.reduce((s,x)=>s+Number(x.roster)-Number(x.incomplete),0),
  unresolvedOfficialIds:byTour.reduce((s,x)=>s+Number(x.missingOfficialId),0),
  missingTotal:byTour.reduce((s,x)=>s+Number(x.incomplete),0),
  minPreviouslyObservedComplete:588,readOnly:true,canAuthorizeWager:false};
result.coverageRegression=result.completeTotal<result.minPreviouslyObservedComplete;
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/tennis-profile-cohort-acceptance.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if(result.coverageRegression)throw Error('TENNIS_PROFILE_COVERAGE_REGRESSION_REQUIRES_REVIEW');
