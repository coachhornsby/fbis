import test from "node:test";
import assert from "node:assert/strict";
import {evaluateProspectiveGradeIntegrity} from "../functions/lib/footballProspectiveGradeIntegrity.js";
import {auditFootballProspectiveGrades} from "../functions/api/football-sdv-prospective.js";
const now="2026-11-03T14:00:00Z";
const base={receiptId:"sdv-1",sport:"nfl",sourceFingerprint:"f".repeat(64),
 homeTeamId:"home-team",awayTeamId:"away-team",
 capturedAt:"2026-10-23T23:00:00Z",kickoff:"2026-10-25T17:00:00Z",
 observedAt:"2026-10-25T22:00:00Z",gradedAt:"2026-10-25T22:15:00Z",
 authority:0,receiptAuthority:0,regulationOnly:1,
 originalSourceCount:1,disagreeingSourceCount:0,actualHome:24,actualAway:17};
test("Postgrade audit identifies empty versus genuinely consistent official results",()=>{
 const empty=evaluateProspectiveGradeIntegrity([],{sport:"nfl",asOf:now});
 assert.equal(empty.status,"NO_GRADED_PROSPECTIVE_EVIDENCE");
 assert.equal(empty.checked,0);
 assert.equal(empty.canAuthorizeWager,false);
 const a=evaluateProspectiveGradeIntegrity([base],{sport:"nfl",asOf:now});
 assert.equal(a.status,"CONSISTENT_WITH_VERIFIED_SOURCE");
 assert.equal(a.checked,1);
 assert.equal(a.distinctGameKickoffs,1);
 assert.equal(a.incidentCount,0);
 assert.equal(a.calibrated,false);
});
test("Later conflicting official scores and erased source fingerprints fail closed",()=>{
 const sample=evaluateProspectiveGradeIntegrity([
  {...base,receiptId:"sdv-conflict",disagreeingSourceCount:1},
  {...base,receiptId:"sdv-missing",originalSourceCount:0},
  {...base,receiptId:"sdv-old",observedAt:"2026-10-24T20:00:00Z"},
  {...base,receiptId:"sdv-permit",authority:1},
 ],{sport:"nfl",asOf:now});
 assert.equal(sample.incidentCount,4);
 assert.equal(sample.classifications.NEW_VERIFIED_SCORE_CONFLICT,1);
 assert.equal(sample.classifications.ORIGINAL_SOURCE_PROVENANCE_MISSING,1);
 assert.equal(sample.classifications.GRADING_CHRONOLOGY_INVALID,1);
 assert.equal(sample.classifications.WAGER_OR_REGULATION_AUTHORITY_INVALID,1);
 assert.equal(sample.canAuthorizeWager,false);
});
test("Auditor never truncates evaluation to 2,000 rows and cannot fall back to PRIMARY",async()=>{
 assert.throws(()=>evaluateProspectiveGradeIntegrity(Array(2001).fill(base),{sport:"nfl",asOf:now,maximum:2000}),
  /GRADE_INTEGRITY_ROWS_EXCEED_LIMIT/);
 await assert.rejects(()=>auditFootballProspectiveGrades({DB:{}},{sport:"nfl",now}),/SPORT_DB_UNBOUND/);
});
test("D1 auditor reads source revisions without writing to grades",async()=>{
 let capturedSQL="";
 const db={prepare(sql){
  capturedSQL=sql;
  return {bind(...args){
   assert.deepEqual(args,[now,"nfl"]);
   return {all:async()=>({results:[base]})};
  }};
 }};
 const report=await auditFootballProspectiveGrades({NFL_DB:db},{sport:"nfl",now});
 assert.equal(report.incidentCount,0);
 assert.ok(capturedSQL.includes("disagreeingSourceCount"));
 assert.ok(capturedSQL.includes("originalSourceCount"));
 assert.ok(capturedSQL.includes("source_observed_at<=?"));
 assert.ok(!capturedSQL.toUpperCase().includes("INSERT"));
});
