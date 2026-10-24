import test from "node:test";
import assert from "node:assert/strict";
import {selectProspectiveRegulationOutcome} from "../functions/lib/footballProspectiveOutcomeSelection.js";
const receipt={receiptId:"receipt-001",sport:"cfb",gameId:"fbis-001",
 homeTeamId:"cfb-1",awayTeamId:"cfb-2",capturedAt:"2026-10-24T01:00:00.000Z",
 kickoff:"2026-10-25T18:00:00Z"};
const source={sport:"cfb",sourceGameId:"4010",homeTeamId:"cfb-1",awayTeamId:"cfb-2",
 kickoff:"2026-10-25T18:00:00.000Z",
 sourceModel:"SDV_ESPN_CFB_PBP_DRIVES",
 sourceFingerprint:"a".repeat(64),observedAt:"2026-10-25T23:00:00Z",
 homeScore:24,awayScore:13};
const now="2026-10-26T04:00:00Z";
test("True official result arrives after kickoff and may be graded later",()=>{
 const s=selectProspectiveRegulationOutcome(receipt,[source],{asOf:now});
 assert.equal(s.status,"VERIFIED_REGULATION_RESULT");
 assert.equal(s.outcome.homeScore,24);
 assert.equal(s.outcome.awayScore,13);
 assert.equal(s.outcome.sourceGameId,"4010");
});
test("Immutable normalization revisions with consistent official scores are usable",()=>{
 const more={...source,sourceFingerprint:"b".repeat(64),observedAt:"2026-10-26T01:00:00Z"};
 const s=selectProspectiveRegulationOutcome(receipt,[source,more],{asOf:now});
 assert.equal(s.status,"VERIFIED_REGULATION_RESULT");
 assert.equal(s.sourceRevisionCount,2);
 assert.equal(s.outcome.sourceFingerprint,more.sourceFingerprint);
});
test("Conflicting verified score revisions fail closed, never pick a convenient result",()=>{
 const wrong={...source,sourceFingerprint:"c".repeat(64),homeScore:31};
 const s=selectProspectiveRegulationOutcome(receipt,[source,wrong],{asOf:now});
 assert.equal(s.status,"CONFLICTING_VERIFIED_SCORES");
 assert.equal(s.outcome,null);
 assert.equal(s.conflictCount,1);
});
test("No future, predating, identity-mismatched or remote-kickoff final is invented",()=>{
 const invalid=[
  {...source,observedAt:"2026-10-25T17:59:00Z"},
  {...source,observedAt:"2026-10-28T12:00:00Z"},
  {...source,kickoff:"2026-10-25T18:40:00Z"},
  {...source,homeTeamId:"cfb-other"},
  {...source,sourceModel:"NFL_PBP_VERIFIED_POSSESSIONS"},
  {...source,sourceFingerprint:"invalid"},
 ];
 const s=selectProspectiveRegulationOutcome(receipt,invalid,{asOf:now});
 assert.equal(s.status,"AWAITING_VERIFIED_OUTCOME");
 assert.equal(s.outcome,null);
 assert.equal(s.invalidSourceCount,4);
});
test("Small schedule-clock drift is eligible only when verified teams and source agree",()=>{
 const shifted={...source,kickoff:"2026-10-25T18:20:00Z"};
 const s=selectProspectiveRegulationOutcome(receipt,[shifted],{asOf:now});
 assert.equal(s.status,"VERIFIED_REGULATION_RESULT");
 assert.equal(s.outcome.awayScore,13);
});
