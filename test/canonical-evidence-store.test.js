import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("canonical prospective persistence stores eligibility and full provenance without deleting invalid evidence", async () => {
  const src=await readFile(new URL("../functions/lib/canonical/evidenceStore.js",import.meta.url),"utf8");
  assert.match(src,/promotionCohortEligibility/);
  assert.match(src,/promotion_exclusion_reasons_json/);
  assert.match(src,/uncertainty_json/);
  assert.match(src,/qualification_authority_json/);
  assert.match(src,/wager_authority_json/);
  assert.doesNotMatch(src,/DELETE FROM fbis_prospective_evidence/i);
});

test("canonical evidence replay fails closed on immutable identity conflict", async () => {
  const src=await readFile(new URL("../functions/lib/canonical/evidenceStore.js",import.meta.url),"utf8");
  assert.match(src,/prospective-evidence-immutable-conflict/);
  assert.match(src,/economic-grade-immutable-conflict/);
  assert.match(src,/prospective-evidence-not-found/);
});

test("economic grades remain per-observation and cohort metrics are not synthesized by the writer", async () => {
  const src=await readFile(new URL("../functions/lib/canonical/evidenceStore.js",import.meta.url),"utf8");
  assert.match(src,/INSERT INTO fbis_economic_grades/);
  assert.doesNotMatch(src,/INSERT INTO fbis_economic_cohort_metrics/);
});
