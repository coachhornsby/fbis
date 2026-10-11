import test from "node:test";
import assert from "node:assert/strict";
import {cfbTotalDispersionAudit,cfbUnitFeatureAudit,gradeCfbFrozenRows,cfbErrorSegments,compareCfbTotalShadows} from "../functions/lib/cfbProspectiveAudit.js";
const base={gameId:"g1",eventStartAt:"2026-10-10T19:00:00Z",predictionAt:"2026-10-10T17:00:00Z",featureCutoffOk:true,projHome:28,projAway:20,actualHome:31,actualAway:17,conference:"SEC"};
test("CFB scoreboard only accepts explicitly pregame frozen predictions",()=>{
 const r=gradeCfbFrozenRows([base,{...base,gameId:"late",predictionAt:"2026-10-10T20:00:00Z"},{...base,gameId:"unsafe",featureCutoffOk:false},{...base,gameId:"early-grade",gradedAt:"2026-10-09T00:00:00Z"}]);
 assert.equal(r.n,1);assert.equal(r.rejected.length,3);assert.equal(r.metrics.marginMae,6);assert.equal(r.metrics.totalMae,0);
 assert.equal(r.canAuthorizeWager,false);
});
test("CFB total dispersion detects severe compression without promoting models",()=>{
 const rows=Array.from({length:24},(_,i)=>({...base,gameId:String(i),projHome:25+(i%2),projAway:26,actualHome:10+i*2,actualAway:20+(i%4)}));
 const d=cfbTotalDispersionAudit(rows);assert.equal(d.compressed,true);assert.equal(d.modelChangeApproved,false);
 const c=compareCfbTotalShadows(rows,{baseline:r=>r.projHome+r.projAway});assert.equal(c.automaticPromotion,false);
 assert.equal(c.challengers.baseline.n,24);
});
test("CFB directional coverage excludes post-start and missing source provenance",()=>{
 const g={featureCutoffOk:true,featureSnapshotAt:"2026-10-10T17:00:00Z",startTime:"2026-10-10T19:00:00Z",cfbDeepInput:{
 away:{rushEpa:.3,rushEpaAllowed:-.1,passEpa:.2,passEpaAllowed:-.2},
 home:{rushEpa:.25,rushEpaAllowed:-.05,passEpa:.1,passEpaAllowed:-.15}}};
 assert.equal(cfbUnitFeatureAudit(g).available,4);
 assert.equal(cfbUnitFeatureAudit({...g,featureSnapshotAt:"2026-10-10T20:00:00Z"}).available,0);
 assert.equal(cfbUnitFeatureAudit({...g,cfbDeepInput:{away:{},home:{}}}).available,0);
});
test("CFB diagnostic segments report only pregame-eligible rows",()=>{
 const segments=cfbErrorSegments([base,{...base,gameId:"late",predictionAt:"2026-10-10T21:00:00Z"}]);
 assert.ok(segments.some(s=>s.segment==="conference:SEC"&&s.marginMae===6));
});
