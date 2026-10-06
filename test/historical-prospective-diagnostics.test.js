import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("historical prospective diagnostic migration can only keep rows ineligible", async () => {
  const sql=await readFile(new URL("../migrations/0093_fbis_historical_evidence_diagnostics.sql",import.meta.url),"utf8");
  assert.match(sql,/promotion_eligible\s*=\s*0/i);
  assert.doesNotMatch(sql,/promotion_eligible\s*=\s*1/i);
  assert.match(sql,/promotion_exclusion_reasons_json\s*=/i);
  assert.match(sql,/WHERE promotion_eligible\s*=\s*0/i);
});

test("historical diagnostic migration derives reasons without backfilling provenance", async () => {
  const sql=await readFile(new URL("../migrations/0093_fbis_historical_evidence_diagnostics.sql",import.meta.url),"utf8");
  for(const reason of [
    "MISSING_SOURCE_OBSERVATION_TIMES","MISSING_STATE_SNAPSHOT","MISSING_MARKET_SNAPSHOT",
    "MISSING_UNCERTAINTY","MISSING_QUALIFICATION_AUTHORITY","MISSING_WAGER_AUTHORITY"
  ]) assert.match(sql,new RegExp(reason));
  const setClause=sql.split(/WHERE promotion_eligible\s*=\s*0/i)[0];
  for(const forbidden of [
    "source_observed_ats_json =","state_snapshot_json =","market_snapshot_json =",
    "uncertainty_json =","qualification_authority_json =","wager_authority_json =",
    "event_id =","model_id =","snapshot_at ="
  ]) assert.equal(setClause.toLowerCase().includes(forbidden.toLowerCase()),false);
});
