import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JOB} from '../services/archive/knownKeyArchive.mjs';
import {DRIVE_ROOT} from '../services/archive/driveArchiveSink.mjs';
import {executionPolicyError} from '../services/account-budget/executionJobs.mjs';
const plan=JSON.parse(readFileSync(new URL('../operations/plans/archive-known-key-activation.json',import.meta.url)));
test('activation review artifact is inactive and cannot certify a production job',()=>{
 assert.equal(plan.executionEnabled,false);assert.equal(plan.mode,'offline-plan-only');assert.equal(plan.job,JOB);
 assert.equal(executionPolicyError({jobs:{[JOB]:{maxUnits:plan.boundedRunProposal.proposedUnits}}},JOB),'JOB_EXECUTION_NOT_CERTIFIED');
 assert.equal(plan.boundedRunProposal.certified,false);assert.equal(plan.boundedRunProposal.admitted,false);
 assert.equal(plan.runtime.publicRoute,null);assert.deepEqual(plan.runtime.cron,[]);assert.equal(plan.runtime.accountBudgetPolicyChange,false);
});
test('candidate identity is pinned but incomplete evidence remains unknown rather than invented',()=>{
 const c=plan.candidate;assert.equal(c.bucket,'fbis-archive');assert.equal(c.historicalBytes,2456);assert.ok(c.key.endsWith(c.sha256+'.json'));
 assert.equal(c.format,'json-document');assert.equal(c.directRecords,0);assert.equal(c.provider,null);assert.equal(c.sourceCapturedAt,null);assert.equal(c.schemaVersion,null);
 assert.equal(c.currentMetadataVerified,false);assert.equal(c.duplicateCoverageVerified,false);assert.equal(c.qualified,false);
});
test('proposed first run has zero LIST/D1/writes and no retries or reference traversal',()=>{
 const run=plan.boundedRunProposal;assert.equal(run.maximumObjects,1);assert.equal(run.maximumSourceBytes,4096);assert.equal(run.followManifestReferences,false);assert.equal(run.automaticRetries,0);
 for(const unit of ['r2Lists','r2Writes','d1Queries','reads','writes'])assert.equal(run.proposedUnits[unit],0);
 assert.equal(run.proposedUnits.r2Reads,2);assert.equal(run.proposedUnits.r2Bytes,plan.candidate.historicalBytes);
 assert.equal(run.cpuMsCeiling,null);assert.equal(run.worstCaseMicroUsd,null);
});
test('unprovisioned dedicated child cannot be replaced with existing parent',()=>{
 assert.equal(plan.destination.rootId,DRIVE_ROOT);assert.equal(plan.destination.categoryName,'04_Model_Evidence');assert.equal(plan.destination.archiveFolderName,'Known_Key_Archive');assert.equal(plan.destination.archiveFolderId,null);
 assert.equal(plan.destination.createBeforeCandidateQualification,false);assert.equal(plan.destination.reuseCategoryAsArchiveFolder,false);
 for(const flag of Object.values(plan.safeguards))assert.equal(flag,false);
 for(const field of ['credentialWiringApproved','sharedR2AndDriveLeaseVerified','crossProcessSerializationVerified'])assert.equal(plan.runtime[field],false);
});
