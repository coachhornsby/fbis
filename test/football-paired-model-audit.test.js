import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePairedModels} from "../functions/lib/footballPairedModelAudit.js";
const row={
 sport:"nfl",gameId:"2026_05_HOU_DAL",kickoff:"2026-10-12T20:00:00Z",
 frozenAt:"2026-10-11T12:00:00Z",baselineSnapshotId:"freeze-a",
 evidenceMode:"RECONSTRUCTED_HISTORICAL_NOT_PIT",prospective:false,canAuthorizeWager:false,
 actualHome:24,actualAway:17,championHome:21,championAway:20,
 challengerHome:25,challengerAway:16,homeLeadProb:.6,awayLeadProb:.3,
 tieProb:.1,homeBlowoutProb:.3,awayBlowoutProb:.15
};
test("Paired CFB/NFL metric deltas score same game and deterministic bootstrap",()=>{
 const rows=Array.from({length:40},(_,i)=>({...row,gameId:"game"+i}));
 const r=evaluatePairedModels(rows,{sport:"nfl",minimumSample:30,bootstrapDraws:200});
 assert.equal(r.n,40);
 assert.equal(r.champion.marginMAE,6);
 assert.equal(r.challenger.marginMAE,2);
 assert.equal(r.pairedDeltas.marginMAE,-4);
 assert.equal(r.pairedDeltas.totalMAE,0);
 assert.deepEqual(r.pairedDeltas.marginBootstrap95,[-4,-4]);
 assert.ok(Math.abs(r.challenger.multiclassBrier-0.26)<1e-12);
 assert.equal(r.historicalPITCertified,false);
 assert.equal(r.canAuthorizeWager,false);
});
test("Duplicate fixtures and prospective mislabels fail closed",()=>{
 assert.throws(()=>evaluatePairedModels([row,row],{sport:"nfl"}),/UNPAIRED_OR_UNVERIFIED/);
 assert.throws(()=>evaluatePairedModels([{...row,prospective:true}],{sport:"nfl"}),/UNPAIRED_OR_UNVERIFIED/);
 assert.throws(()=>evaluatePairedModels([{...row,baselineSnapshotId:null}],{sport:"nfl"}),/UNPAIRED_OR_UNVERIFIED/);
 assert.throws(()=>evaluatePairedModels([{...row,frozenAt:"2026-10-13T00:00:00Z"}],{sport:"nfl"}),/UNPAIRED_OR_UNVERIFIED/);
});
test("No sample never claims calibration or performance",()=>{
 const r=evaluatePairedModels([],{sport:"cfb"});
 assert.equal(r.status,"INSUFFICIENT_PAIRED_SAMPLE");
 assert.equal(r.challenger.marginMAE,null);
 assert.equal(r.pairedDeltas.marginBootstrap95,null);
});
