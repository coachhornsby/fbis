import test from "node:test";
import assert from "node:assert/strict";

import {
  ASIAN_BASEBALL_DATA_CONTRACTS,
  ASIAN_BASEBALL_SOURCE_STATE,
  asianBaseballDataReadiness,
} from "../functions/lib/asianBaseballDataContracts.js";

test("KBO and NPB inventory remain fail-closed on missing durable evidence",()=>{
  for(const league of ["kbo","npb"]){
    const c=ASIAN_BASEBALL_DATA_CONTRACTS[league];
    assert.ok(c);
    assert.equal(c.gaps.historicalPersistence,ASIAN_BASEBALL_SOURCE_STATE.MISSING);
    assert.equal(c.gaps.oddsHistoryPersistence,ASIAN_BASEBALL_SOURCE_STATE.MISSING);
    assert.equal(c.validation.canQualify,false);
    assert.equal(c.validation.canAuthorize,false);
  }
});

test("readiness reports concrete blockers and never grants wagering authority",()=>{
  for(const league of ["kbo","npb"]){
    const r=asianBaseballDataReadiness(league);
    assert.equal(r.ok,true);
    assert.equal(r.researchReady,true);
    assert.equal(r.productionDataReady,false);
    assert.equal(r.canQualify,false);
    assert.equal(r.canAuthorize,false);
    assert.ok(r.blockers.includes("historical_persistence_missing"));
    assert.ok(r.blockers.includes("odds_history_persistence_missing"));
    assert.ok(r.blockers.includes("bounded_backfill_missing"));
  }
});

test("unsupported leagues fail closed",()=>{
  assert.deepEqual(asianBaseballDataReadiness("mlb"),{ok:false,reason:"unsupported-league"});
});
