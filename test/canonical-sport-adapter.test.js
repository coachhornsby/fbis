import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  canonicalEvidenceId,
  canonicalGradeId,
  canonicalAdapterReconciliation,
  twoWayNoVigFromPrices,
} from "../functions/lib/canonical/sportEvidenceAdapter.js";

test("canonical adapter ids are deterministic and gate-versioned",()=>{
  const a=canonicalEvidenceId({sport:"nfl",sourceTable:"nfl_qb_personnel_shadow_predictions",sourceId:"row1",gateVersion:"NFL-QB-PROSPECTIVE-GATE-v1"});
  const b=canonicalEvidenceId({sport:"nfl",sourceTable:"nfl_qb_personnel_shadow_predictions",sourceId:"row1",gateVersion:"NFL-QB-PROSPECTIVE-GATE-v1"});
  const c=canonicalEvidenceId({sport:"nfl",sourceTable:"nfl_qb_personnel_shadow_predictions",sourceId:"row1",gateVersion:"other"});
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.match(a,/^pe_[0-9a-f]{64}$/);
  assert.match(canonicalGradeId({evidenceId:a,marketFamily:"moneyline_probability",selection:"HOME"}),/^eg_[0-9a-f]{64}$/);
});

test("canonical reconciliation fails closed on count, duplicate, or temporal mismatch",()=>{
  assert.equal(canonicalAdapterReconciliation({sourceCount:5,canonicalCount:4,excluded:1}).exact,true);
  assert.equal(canonicalAdapterReconciliation({sourceCount:5,canonicalCount:5,excluded:1}).exact,false);
  assert.equal(canonicalAdapterReconciliation({sourceCount:5,canonicalCount:4,excluded:1,duplicates:1}).exact,false);
  assert.equal(canonicalAdapterReconciliation({sourceCount:5,canonicalCount:4,excluded:1,temporalFailures:1}).exact,false);
});

test("two-way no-vig normalization is canonical",()=>{
  const x=twoWayNoVigFromPrices(-110,-110);
  assert.equal(Number(x.a.toFixed(8)),0.5);
  assert.equal(Number(x.b.toFixed(8)),0.5);
  assert.ok(x.vig>0);
});

test("NFL adapter keeps legacy source row immutable and dual-writes only versioned cohort",async()=>{
  const api=await readFile(new URL("../functions/api/nfl-qb-shadow.js",import.meta.url),"utf8");
  assert.match(api,/storageCheckpoint=.*criteria\.gateId/);
  assert.match(api,/persistCanonicalProspectiveEvidence/);
  assert.match(api,/sourceTable:"nfl_qb_personnel_shadow_predictions"/);
  assert.match(api,/minSnapshotAt:criteria\.frozenAt/);
  assert.match(api,/persistCanonicalEconomicGrade/);
  assert.match(api,/sourceClvSemantics:"spread_line_movement_points"/);
});

test("NHL adapter excludes context-only state from canonical shadow cohort",async()=>{
  const api=await readFile(new URL("../functions/api/nhl-goalie-shadow.js",import.meta.url),"utf8");
  assert.match(api,/if\(!r\.gateFired\)\{canonicalContextExcluded\+\+;continue;\}/);
  assert.match(api,/persistCanonicalProspectiveEvidence/);
  assert.match(api,/sourceTable:"nhl_goalie_probability_shadow"/);
  assert.match(api,/gateVersion:PROSPECTIVE_GATE\.gateVersion/);
  assert.match(api,/persistCanonicalEconomicGrade/);
  assert.match(api,/executionEvidence:false/);
});
