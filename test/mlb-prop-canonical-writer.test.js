import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MLB prop producer uses shared canonical evidence writers while preserving sport-specific ledger", async () => {
  const src=await readFile(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  assert.match(src,/persistProspectiveEvidence/);
  assert.match(src,/persistEconomicGrade/);
  assert.match(src,/INSERT OR IGNORE INTO mlb_prop_prospective_evidence/);
  assert.doesNotMatch(src,/INSERT OR IGNORE INTO fbis_prospective_evidence/);
  assert.doesNotMatch(src,/INSERT OR IGNORE INTO fbis_economic_grades/);
  assert.match(src,/championModelId:"MLB-SAVANT-RPG-SP"/);
  assert.match(src,/canQualify:false/);
  assert.match(src,/canAuthorize:false/);
});

test("MLB prop economic grade preserves entry snapshot and leaves absent close evidence null", async () => {
  const src=await readFile(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  assert.match(src,/entryMarketSnapshotId:row\.duplicate_key/);
  assert.match(src,/entryObservedAt:row\.market_observed_at/);
  assert.match(src,/closeMarketSnapshotId:null/);
  assert.match(src,/closeObservedAt:null/);
});
