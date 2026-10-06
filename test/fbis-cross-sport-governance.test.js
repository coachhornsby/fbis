import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildProspectiveEvidence,
  promotionCohortEligibility,
  PROSPECTIVE_LIFECYCLE,
} from "../functions/lib/canonical/prospectiveEvidence.js";
import {
  americanImpliedProbability,
  noVigPair,
  buildEconomicGrade,
  maximumDrawdown,
} from "../functions/lib/canonical/economicGrading.js";
import {
  buildStateObservation,
  resolveCurrentState,
  observationFreshness,
} from "../functions/lib/canonical/persistentState.js";

test("prospective evidence rejects post-start and future-source leakage", () => {
  const row = buildProspectiveEvidence({
    evidenceId: "e1",
    sport: "nba",
    eventId: "g1",
    eventStartAt: "2026-10-10T00:00:00Z",
    snapshotAt: "2026-10-10T00:05:00Z",
    championModelId: "champ",
    modelId: "shadow",
    sourceObservedAts: ["2026-10-10T00:06:00Z"],
  });
  assert.equal(row.temporalIntegrity.ok, false);
  assert.ok(row.temporalIntegrity.problems.includes("POST_START_SNAPSHOT"));
  assert.ok(row.temporalIntegrity.problems.includes("FUTURE_SOURCE_OBSERVATION"));
});

test("promotion cohorts exclude legacy and wrong gate versions", () => {
  const row = buildProspectiveEvidence({
    evidenceId: "e2",
    sport: "nfl",
    eventId: "g2",
    eventStartAt: "2026-10-12T18:00:00Z",
    snapshotAt: "2026-10-12T12:00:00Z",
    championModelId: "NFL-PRO-v1.1",
    modelId: "QB-shadow",
    gateVersion: "NFL-QB-PROSPECTIVE-GATE-v1",
    lifecycle: PROSPECTIVE_LIFECYCLE.SHADOW,
    stateSnapshotId: "state-g2",
    marketSnapshotId: "market-g2",
    marketObservedAt: "2026-10-12T11:55:00Z",
    sourceObservedAts: ["2026-10-12T11:50:00Z"],
    codeSha: "abc123",
    stateSnapshot: { asOf: "2026-10-12T11:50:00Z" },
    marketSnapshot: { asOf: "2026-10-12T11:55:00Z" },
    uncertainty: { state: "UNKNOWN", reason: "research-shadow" },
    incumbentProjection: { value: 0.5 },
    challengerProjection: { value: 0.52 },
    qualificationAuthority: { canQualify: false, source: "model-registry" },
    wagerAuthority: { canAuthorize: false, source: "model-registry" },
  });
  assert.equal(promotionCohortEligibility(row, {gateVersion:"NFL-QB-PROSPECTIVE-GATE-v1"}).eligible, true);
  assert.equal(promotionCohortEligibility({...row, legacy:true}, {gateVersion:"NFL-QB-PROSPECTIVE-GATE-v1"}).eligible, false);
  assert.equal(promotionCohortEligibility(row, {gateVersion:"other"}).eligible, false);
});

test("economic grading normalizes vig, CLV, ROI and drawdown", () => {
  assert.ok(americanImpliedProbability(-110) > 0.52);
  const nv = noVigPair(-110, -110);
  assert.equal(Number(nv.a.toFixed(6)), 0.5);
  const grade = buildEconomicGrade({
    gradeId:"gr1",
    evidenceId:"e1",
    sport:"nba",
    eventId:"g1",
    marketFamily:"spread",
    selection:"HOME",
    projectedProbability:0.58,
    entryPrice:-110,
    entryNoVigProbability:0.52,
    closeNoVigProbability:0.55,
    result:"WIN",
  });
  assert.ok(grade.clvProbability > 0);
  assert.ok(grade.profitUnits > 0);
  assert.ok(grade.roi > 0);
  assert.equal(maximumDrawdown([1,-1,-1,2]), 2);
});

test("persistent state carries stronger fresh evidence and expires stale evidence", () => {
  const official = buildStateObservation({
    observationId:"s1", sport:"nba", entityType:"player", entityId:"p1",
    stateFamily:"availability", value:"OUT", source:"official",
    evidenceClass:"OFFICIAL_REPORT", evidenceRank:100,
    observedAt:"2026-10-05T10:00:00Z",
  });
  const secondary = buildStateObservation({
    observationId:"s2", sport:"nba", entityType:"player", entityId:"p1",
    stateFamily:"availability", value:"AVAILABLE", source:"secondary",
    evidenceClass:"SECONDARY", evidenceRank:10,
    observedAt:"2026-10-05T12:00:00Z",
  });
  const resolved = resolveCurrentState([official, secondary], {
    asOf:"2026-10-05T13:00:00Z",
    maxAgeMs:24*60*60*1000,
  });
  assert.equal(resolved.current.observationId, "s1");
  assert.equal(resolved.carried, true);
  assert.equal(observationFreshness(official, {
    asOf:"2026-10-07T13:00:00Z",
    maxAgeMs:24*60*60*1000,
  }).fresh, false);
});


test("promotion cohort preserves incomplete evidence but excludes it fail-closed", () => {
  const row = buildProspectiveEvidence({
    evidenceId: "e-incomplete",
    sport: "nfl",
    eventId: "g-incomplete",
    eventStartAt: "2026-10-12T18:00:00Z",
    snapshotAt: "2026-10-12T12:00:00Z",
    championModelId: "NFL-PINNACLE-IMPLIED",
    modelId: "NFL-FBIS-PURE",
    gateVersion: "NFL-GATE-v1",
  });
  const out = promotionCohortEligibility(row, { gateVersion: "NFL-GATE-v1" });
  assert.equal(out.eligible, false);
  assert.ok(out.reasons.includes("MISSING_STATE_SNAPSHOT_ID"));
  assert.ok(out.reasons.includes("MISSING_MARKET_SNAPSHOT"));
  assert.ok(out.reasons.includes("MISSING_UNCERTAINTY"));
  assert.ok(out.reasons.includes("MISSING_SOURCE_OBSERVATION_TIMES"));
});


test("0091 keeps prospective and economic provenance additive and cohort-scoped", async () => {
  const migration = await readFile(new URL("../migrations/0091_fbis_prospective_economic_provenance.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE fbis_prospective_evidence ADD COLUMN source_observed_ats_json/);
  assert.match(migration, /ALTER TABLE fbis_prospective_evidence ADD COLUMN uncertainty_json/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS fbis_economic_cohort_metrics/);
  assert.match(migration, /calibration_method_version/);
  assert.match(migration, /drawdown_method_version/);
  assert.match(migration, /0091_fbis_prospective_economic_provenance/);
  assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE/i);
});
