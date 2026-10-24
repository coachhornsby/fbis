import test from "node:test";
import assert from "node:assert/strict";
import {prepareProspectiveFootballReceipt} from "../functions/api/football-sdv-prospective.js";
const model={ok:true,sport:"nfl",gameId:"game-1",homeTeamId:"nfl-1",awayTeamId:"nfl-2",
 sourceSnapshotId:"snapshot-1",modelId:"NFL-VERIFIED-POSSESSION-MATCHUP-SHADOW-v0",
 modelVersion:"0.1.0",evidenceFingerprint:"b".repeat(64),
 baselineFrozenAt:"2026-10-22T09:00:00Z",kickoff:"2026-10-24T19:00:00Z",
 calibrationStatus:"NOT_VALIDATED",canQualify:false,canAuthorizeWager:false,
 trainingGames:200,trainingDrives:4000,mode:"RESEARCH_SHADOW_ONLY",
 sourceDb:"NFL_DB",researchAsOf:"2026-10-23T18:00:00Z",
 distributions:{
 home_regulation_lead:{mean:.54},away_regulation_lead:{mean:.4},
 regulation_tie:{mean:.06},home_blowout_14:{mean:.2},away_blowout_14:{mean:.1},
 home_score:{mean:24.5},away_score:{mean:22.1}
 }};
const now="2026-10-23T18:00:00Z";
test("A real pregame receipt is reproducible and remains research-only",()=>{
 const a=prepareProspectiveFootballReceipt(model,{now});
 const b=prepareProspectiveFootballReceipt(model,{now});
 assert.equal(a.receiptId,b.receiptId);
 assert.equal(a.homeLead+a.awayLead+a.tie,1);
 assert.equal(a.captureAt,undefined);
 assert.equal(a.capturedAt,now);
 assert.equal(JSON.parse(a.evidence).canAuthorizeWager,false);
});
test("No fake or late receipts: missing provenance, kickoff proximity and malformed distribution rejected",()=>{
 assert.throws(()=>prepareProspectiveFootballReceipt({...model,canAuthorizeWager:true},{now}),/PROSPECTIVE_RESEARCH_EVIDENCE_NOT_READY/);
 assert.throws(()=>prepareProspectiveFootballReceipt({...model,evidenceFingerprint:null},{now}),/PROSPECTIVE_RESEARCH_EVIDENCE_NOT_READY/);
 assert.throws(()=>prepareProspectiveFootballReceipt({...model,kickoff:"2026-10-23T18:09:00Z"},{now}),/PROSPECTIVE_RESEARCH_EVIDENCE_NOT_READY/);
 assert.throws(()=>prepareProspectiveFootballReceipt({...model,trainingDrives:20},{now}),/PROSPECTIVE_RESEARCH_EVIDENCE_NOT_READY/);
 assert.throws(()=>prepareProspectiveFootballReceipt({...model,distributions:{...model.distributions,regulation_tie:{mean:.25}}},{now}),/PROSPECTIVE_DISTRIBUTION_INVALID/);
});

test("The independently versioned NFL verified-transition receipt cannot overwrite the legacy model",()=>{
 const next={...model,modelId:"NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3",
  modelVersion:"0.3.0",variant:"nfl-sdv-v03",timeEvidence:"NFLFASTR_REPORTED_DRIVE_TIME_OF_POSSESSION",
  fieldTransitionMode:"OBSERVED_NEXT_DRIVE_FIELD_CONDITIONING",
  officialDurationDrives:700,linkedNextFieldDrives:680};
 const legacy=prepareProspectiveFootballReceipt(model,{now});
 const enhanced=prepareProspectiveFootballReceipt(next,{now});
 assert.notEqual(enhanced.receiptId,legacy.receiptId);
 assert.equal(enhanced.modelId,next.modelId);
 assert.equal(JSON.parse(enhanced.evidence).variant,"nfl-sdv-v03");
 assert.equal(JSON.parse(enhanced.evidence).timeEvidence,
  "NFLFASTR_REPORTED_DRIVE_TIME_OF_POSSESSION");
 assert.equal(JSON.parse(enhanced.evidence).canAuthorizeWager,false);
});
