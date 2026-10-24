import test from "node:test";
import assert from "node:assert/strict";
import {evaluateChronologicalTotalOnly,totalOnlyProjection,evaluateChronologicalCfbMarginBias} from "../functions/lib/footballChronologicalTotalResearch.js";
function row(i,date){
 return {sport:"cfb",gameId:"g"+i,kickoff:date+"T18:00:00Z",
 frozenAt:"2026-09-01T00:00:00Z",
 evidenceMode:"RECONSTRUCTED_HISTORICAL_NOT_PIT",
 prospective:false,canAuthorizeWager:false,
 actualHome:30,actualAway:20,championHome:26,championAway:18,
 challengerHome:27,challengerAway:21};
}
test("Total-only challenger preserves signed champion margin and nonnegative scores",()=>{
 const p=totalOnlyProjection(row(1,"2026-10-01"),.5);
 assert.equal(p.margin,8);
 assert.equal(p.home-p.away,8);
 assert.equal(p.home+p.away,46);
 assert.equal(p.canAuthorizeWager,false);
 assert.equal(totalOnlyProjection({...row(1,"2026-10-01"),championHome:40,
  championAway:1,challengerHome:1,challengerAway:1},1),null);
});
test("Calendar-day groups never cross chronological train vs holdout",()=>{
 const rows=[];
 for(let day=1;day<=10;day++)for(let k=0;k<10;k++)
  rows.push(row(day*10+k,"2026-10-"+String(day).padStart(2,"0")));
 const r=evaluateChronologicalTotalOnly(rows,{sport:"cfb",minTrain:50,minHoldout:30});
 assert.equal(r.trainN,60);assert.equal(r.holdoutN,40);
 assert.equal(r.cutoffDay,"2026-10-07");
 assert.equal(r.alpha,1); // Synthetic data favors challenger total.
 assert.equal(r.canAuthorizeWager,false);
});
test("No sample, broken pregame clock or misclassified historical records fail closed",()=>{
 assert.equal(evaluateChronologicalTotalOnly([],{sport:"nfl"}).status,"NO_VERIFIED_GAMES");
 const x=row(1,"2026-10-01");
 assert.throws(()=>evaluateChronologicalTotalOnly([{...x,prospective:true}],{sport:"cfb"}),/INVALID_RECONSTRUCTED/);
 assert.throws(()=>evaluateChronologicalTotalOnly([{...x,frozenAt:"2026-10-02T18:00:00Z"}],{sport:"cfb"}),/INVALID_RECONSTRUCTED/);
 assert.throws(()=>evaluateChronologicalTotalOnly([x,x],{sport:"cfb"}),/INVALID_RECONSTRUCTED/);
});
test("Tiny football samples cannot be promoted on training-only improvements",()=>{
 const rows=Array.from({length:31},(_,i)=>row(i,"2026-10-"+String(1+Math.floor(i/4)).padStart(2,"0")));
 const e=evaluateChronologicalTotalOnly(rows,{sport:"cfb",minTrain:50,minHoldout:20});
 assert.equal(e.status,"INSUFFICIENT_CHRONOLOGICAL_EVIDENCE");
 assert.equal(e.canQualify,false);
});

test("CFB margin bias is fit on earlier days while preserving total and never authorizing wagers",()=>{
 const rows=[];
 for(let d=1;d<=10;d++)for(let j=0;j<10;j++)
  rows.push(row(d*10+j,"2026-10-"+String(d).padStart(2,"0")));
 const r=evaluateChronologicalCfbMarginBias(rows);
 assert.equal(r.cutoffDay,"2026-10-07");
 assert.equal(r.trainN,60);
 assert.equal(r.holdoutN,40);
 assert.ok(Number.isFinite(r.shift));
 assert.equal(r.championTotalPreserved,true);
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.prospectiveValidated,false);
});
