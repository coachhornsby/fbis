import test from "node:test";
import assert from "node:assert/strict";
import {compareCfbProspectiveToFrozenChampion} from "../functions/lib/cfbSdvProspectiveChampionAudit.js";
const base={modelId:"CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0",championModelVersion:"CFB-FBIS-v2",
 gameId:"401234",receiptId:"receipt-1",baselineSnapshotId:"base-1",
 kickoff:"2026-10-31T18:00:00Z",capturedAt:"2026-10-30T16:00:00Z",
 baselineFrozenAt:"2026-10-30T10:00:00Z",
 observedAt:"2026-10-31T23:00:00Z",gradedAt:"2026-11-01T02:00:00Z",
 homeTeamId:"cfb-1",awayTeamId:"cfb-2",sourceFingerprint:"official-score-receipt",
 actualHome:30,actualAway:20,championHome:26,championAway:23,
 challengerHome:30,challengerAway:18};
const asOf="2026-11-02T00:00:00Z";
test("Prospectively paired CFB improvement is descriptive, never wager-authorized",()=>{
 const rows=Array.from({length:32},(_,i)=>({...base,gameId:"g"+i,
  receiptId:"receipt"+i,homeTeamId:"cfb-"+(i+1),awayTeamId:"cfb-other-"+i}));
 const r=compareCfbProspectiveToFrozenChampion(rows,{asOf});
 assert.equal(r.n,32);
 assert.ok(r.challenger.marginMAE<r.champion.marginMAE);
 assert.ok(r.pairedDeltas.marginBootstrap95);
 assert.equal(r.canQualify,false);
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.CLV,null);
 assert.equal(r.ROI,null);
});
test("Provider duplicate IDs and postkickoff fake receipts are excluded",()=>{
 const valid={...base};
 const otherProvider={...base,gameId:"other-provider",receiptId:"receipt-other"};
 const late={...base,homeTeamId:"cfb-987",receiptId:"late",
  capturedAt:"2026-11-01T00:00:00Z"};
 const r=compareCfbProspectiveToFrozenChampion([valid,otherProvider,late],{asOf});
 assert.equal(r.n,1);
 assert.equal(r.excluded.INVALID_PROSPECTIVE_CHRONOLOGY,1);
 assert.equal(r.status,"INSUFFICIENT_PROSPECTIVE_PAIRED_SAMPLE");
});
test("Missing outcomes or wrong champion identity cannot enter paired metrics",()=>{
 const rows=[{...base,actualHome:null},{...base,gameId:"x",
  championModelVersion:"CFB-FBIS-v1"}];
 const r=compareCfbProspectiveToFrozenChampion(rows,{asOf});
 assert.equal(r.n,0);
 assert.equal(r.excluded.SCORE_MISSING_OR_INVALID,1);
 assert.equal(r.excluded.MODEL_IDENTITY_MISMATCH,1);
});
