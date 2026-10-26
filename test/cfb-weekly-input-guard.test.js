import test from "node:test";
import assert from "node:assert/strict";
import {validateWeeklyCsv,produceReceipt} from "../scripts/cfb-weekly-input-guard.mjs";
const head="id,start_date,season,season_type,week,home_team,away_team,spread,home_adjusted_epa,away_adjusted_epa";
const row="401866451,2026-10-31 02:30:00,2026,regular,9,Sacramento State,Kent State,10.5,-0.06,-0.02";
const obs="2026-10-26T13:47:00Z";
test("validates week-nine point-in-time input without giving wagering authority",()=>{
 const r=produceReceipt(head+"\n"+row+"\n",{observedAt:obs});
 assert.equal(r.rowCount,1);assert.equal(r.officialFinals,0);assert.equal(r.modelPromotion,false);
 assert.equal(r.sourceObservedAt,obs);
});
test("rejects duplicates, stale rows and invalid feature values",()=>{
 assert.throws(()=>validateWeeklyCsv(head+"\n"+row+"\n"+row,{observedAt:obs}),/DUPLICATE/);
 assert.throws(()=>validateWeeklyCsv(head+"\n"+row,{observedAt:"2026-11-01T00:00:00Z"}),/NOT_PROSPECTIVE/);
 assert.throws(()=>validateWeeklyCsv(head+"\n"+row.replace("10.5","x"),{observedAt:obs}),/NONFINITE/);
});
test("rejects missing explicit observed-at provenance",()=>{
 assert.throws(()=>validateWeeklyCsv(head+"\n"+row,{}),/EXPLICIT/);
});
