import test from "node:test";
import assert from "node:assert/strict";
import {compareNflProspectiveShadowReceipts,
 NFL_STANDARD_SHADOW,NFL_VERIFIED_TRANSITION_SHADOW} from "../functions/lib/nflSdvProspectivePairedEvaluation.js";
const base={receiptId:"receipt-1",gameId:"game",homeTeamId:"nfl-HOU",awayTeamId:"nfl-TEN",
 kickoff:"2026-10-25T17:00:00Z",capturedAt:"2026-10-24T10:00:00Z",
 gradedAt:"2026-10-25T22:00:00Z",observedAt:"2026-10-25T21:30:00Z",
 outcomeFingerprint:"source-1",actualHome:24,actualAway:21,projectedHome:26,projectedAway:18,
 homeLead:.52,awayLead:.43,tieProb:.05};
const asOf="2026-10-26T12:00:00Z";
test("Same-game independent prospective models grade once and remain unqualified",()=>{
 const rows=[];
 for(let i=0;i<35;i++){
  const a={...base,gameId:"game"+i,receiptId:"standard"+i,
   kickoff:"2026-10-25T17:00:00Z",homeTeamId:"nfl-HOU"+i,
   modelId:NFL_STANDARD_SHADOW};
  const b={...a,modelId:NFL_VERIFIED_TRANSITION_SHADOW,receiptId:"transition"+i,
   projectedHome:25,projectedAway:20};
  rows.push(a,b);
 }
 const r=compareNflProspectiveShadowReceipts(rows,{asOf});
 assert.equal(r.n,35);
 assert.equal(r.status,"PROSPECTIVE_DESCRIPTIVE_COMPARISON");
 assert.ok(r.transition.totalMAE<r.standard.totalMAE);
 assert.ok(r.differences.totalMAE.bootstrap95);
 assert.equal(r.CLV,null);
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.calibrated,false);
});
test("Duplicate provider IDs cannot count as extra independent events",()=>{
 const a={...base,modelId:NFL_STANDARD_SHADOW};
 const b={...base,modelId:NFL_VERIFIED_TRANSITION_SHADOW,receiptId:"receipt-2"};
 const clone={...a,gameId:"other-provider-id",receiptId:"new",capturedAt:"2026-10-24T11:00:00Z"};
 const r=compareNflProspectiveShadowReceipts([a,b,clone],{asOf});
 assert.equal(r.n,1);
 assert.equal(r.status,"INSUFFICIENT_PROSPECTIVE_PAIR_SAMPLE");
 assert.equal(r.differences.marginMAE.bootstrap95,null);
});
test("Late and unreconciled records are rejected",()=>{
 const a={...base,modelId:NFL_STANDARD_SHADOW,capturedAt:"2026-10-26T00:00:00Z"};
 const b={...base,modelId:NFL_VERIFIED_TRANSITION_SHADOW,receiptId:"receipt-2"};
 const r=compareNflProspectiveShadowReceipts([a,b],{asOf});
 assert.equal(r.n,0);
 assert.equal(r.excluded.TEMPORAL_OR_PROVENANCE_INVALID,1);
 assert.equal(r.excluded.UNPAIRED_EVENT,1);
});
