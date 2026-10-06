import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { persistProspectiveEvidence, persistEconomicGrade } from "../functions/lib/canonical/evidenceStore.js";

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


function fakeDb({ prospectiveExisting = null, gradeExisting = null, evidenceForGrade = null } = {}) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM fbis_prospective_evidence WHERE evidence_id=?") && sql.includes("promotion_eligible")) return evidenceForGrade;
              if (sql.includes("FROM fbis_prospective_evidence WHERE evidence_id=?")) return prospectiveExisting;
              if (sql.includes("FROM fbis_economic_grades WHERE grade_id=?")) return gradeExisting;
              return null;
            },
            async run() {
              writes.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function validEvidence(overrides = {}) {
  return {
    evidenceId: "ev-1",
    sport: "mlb",
    eventId: "game-1",
    eventStartAt: "2026-10-07T00:00:00Z",
    snapshotAt: "2026-10-06T20:00:00Z",
    championModelId: "MLB-SAVANT-RPG-SP",
    modelId: "MLB-CHALLENGER-SHADOW",
    modelVersion: "shadow-v1",
    lifecycle: "SHADOW",
    gateVersion: "gate-v1",
    stateSnapshotId: "state-1",
    marketSnapshotId: "market-1",
    marketObservedAt: "2026-10-06T19:59:00Z",
    sourceObservedAts: ["2026-10-06T19:58:00Z"],
    codeSha: "abc123",
    stateSnapshot: { source: "test", value: 1 },
    marketSnapshot: { priceA: -110, priceB: -110 },
    uncertainty: { sigma: 1.2 },
    incumbentProjection: { p: 0.51 },
    challengerProjection: { p: 0.54 },
    qualificationAuthority: { canQualify: false },
    wagerAuthority: { canAuthorize: false },
    canQualify: false,
    canAuthorize: false,
    ...overrides,
  };
}

test("behavior: incomplete but validly shaped evidence is retained and promotion-ineligible", async () => {
  const db = fakeDb();
  const out = await persistProspectiveEvidence({ DB: db }, validEvidence({ uncertainty: null }));
  assert.equal(out.ok, true);
  assert.equal(out.inserted, true);
  assert.equal(out.promotionEligible, false);
  assert.ok(out.promotionExclusionReasons.includes("MISSING_UNCERTAINTY"));
  assert.equal(db.writes.length, 1);
  const eligibleIndex = 29;
  assert.equal(db.writes[0].args[eligibleIndex], 0);
});

test("behavior: complete shadow evidence may be promotion-eligible without wager authority", async () => {
  const db = fakeDb();
  const out = await persistProspectiveEvidence({ DB: db }, validEvidence());
  assert.equal(out.ok, true);
  assert.equal(out.promotionEligible, true);
  assert.equal(db.writes[0].args[21], 0);
  assert.equal(db.writes[0].args[29], 1);
});

test("behavior: immutable evidence replay conflict fails closed", async () => {
  const input = validEvidence();
  const existing = {
    sport: "mlb", event_id: "different-event", event_start_at: input.eventStartAt, snapshot_at: input.snapshotAt,
    champion_model_id: input.championModelId, model_id: input.modelId, model_version: input.modelVersion,
    lifecycle: input.lifecycle, gate_version: input.gateVersion, state_snapshot_id: input.stateSnapshotId,
    market_snapshot_id: input.marketSnapshotId, market_observed_at: input.marketObservedAt, code_sha: input.codeSha,
    legacy: 0, can_qualify: 0, can_authorize: 0,
    incumbent_projection_json: JSON.stringify(input.incumbentProjection),
    challenger_projection_json: JSON.stringify(input.challengerProjection),
    governance_json: "{}", source_observed_ats_json: JSON.stringify(input.sourceObservedAts),
    state_snapshot_json: JSON.stringify(input.stateSnapshot), market_snapshot_json: JSON.stringify(input.marketSnapshot),
    uncertainty_json: JSON.stringify(input.uncertainty), qualification_authority_json: JSON.stringify(input.qualificationAuthority),
    wager_authority_json: JSON.stringify(input.wagerAuthority), promotion_eligible: 0,
  };
  const db = fakeDb({ prospectiveExisting: existing });
  const out = await persistProspectiveEvidence({ DB: db }, input);
  assert.equal(out.ok, false);
  assert.equal(out.conflict, true);
  assert.ok(out.fields.includes("event_id"));
  assert.equal(db.writes.length, 0);
});

test("behavior: economic grade requires prospective evidence", async () => {
  const db = fakeDb({ evidenceForGrade: null });
  const out = await persistEconomicGrade({ DB: db }, {
    gradeId: "g-1", evidenceId: "missing", sport: "mlb", eventId: "game-1",
    marketFamily: "ML", selection: "HOME", projectedProbability: 0.55, entryPrice: -110, result: "WON",
  });
  assert.deepEqual(out, { ok: false, reason: "prospective-evidence-not-found" });
  assert.equal(db.writes.length, 0);
});

test("behavior: economic grade persists stake provenance", async () => {
  const db = fakeDb({ evidenceForGrade: { evidence_id: "ev-1", sport: "mlb", event_id: "game-1", market_snapshot_id: "market-1", market_observed_at: "2026-10-06T19:59:00.000Z", promotion_eligible: 0 } });
  const out = await persistEconomicGrade({ DB: db }, {
    gradeId: "g-1", evidenceId: "ev-1", sport: "mlb", eventId: "game-1",
    marketFamily: "ML", selection: "HOME", projectedProbability: 0.55, entryPrice: -110,
    result: "WON", stakeUnits: 2, gradedAt: "2026-10-07T04:00:00Z",
    metadata: { entryMarketSnapshotId: "market-1", entryObservedAt: "2026-10-06T19:59:00.000Z", economicBasis: "SIMULATED_1U_PRICE_AVAILABLE", metricMethodVersion: "FBIS-ECONOMIC-GRADE-v1" },
  });
  assert.equal(out.ok, true);
  assert.equal(out.inserted, true);
  assert.match(db.writes[0].sql, /stake_units/);
  assert.equal(db.writes[0].args[15], 2);
});


test("behavior: explicit UNKNOWN uncertainty remains promotion-ineligible", async () => {
  const db = fakeDb();
  const out = await persistProspectiveEvidence({ DB: db }, validEvidence({ uncertainty: { state: "UNKNOWN", sigma: null } }));
  assert.equal(out.ok, true);
  assert.equal(out.promotionEligible, false);
  assert.ok(out.promotionExclusionReasons.includes("MISSING_UNCERTAINTY"));
});

test("behavior: economic grade requires entry market provenance", async () => {
  const db = fakeDb({ evidenceForGrade: { evidence_id: "ev-1", sport: "mlb", event_id: "game-1", market_snapshot_id: "market-1", market_observed_at: "2026-10-06T19:59:00.000Z", promotion_eligible: 0 } });
  const out = await persistEconomicGrade({ DB: db }, {
    gradeId: "g-missing-prov", evidenceId: "ev-1", sport: "mlb", eventId: "game-1",
    marketFamily: "ML", selection: "HOME", entryPrice: -110, result: "WON", stakeUnits: 1,
    metadata: { economicBasis: "SIMULATED_1U_PRICE_AVAILABLE", metricMethodVersion: "FBIS-ECONOMIC-GRADE-v1" },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "economic-grade-provenance-incomplete");
  assert.equal(db.writes.length, 0);
});


test("behavior: economic grade must bind to the same sport event and entry market evidence", async () => {
  const evidence = {
    evidence_id: "ev-1", sport: "mlb", event_id: "game-1",
    market_snapshot_id: "market-1", market_observed_at: "2026-10-06T19:59:00.000Z",
    promotion_eligible: 0,
  };
  const base = {
    gradeId: "g-link", evidenceId: "ev-1", sport: "mlb", eventId: "game-1",
    marketFamily: "player-prop", selection: "OVER", entryPrice: -110, result: "WON",
    metadata: {
      entryMarketSnapshotId: "market-1",
      entryObservedAt: "2026-10-06T19:59:00.000Z",
      economicBasis: "SIMULATED_1U_PRICE_AVAILABLE",
      metricMethodVersion: "FBIS-ECONOMIC-GRADE-v1",
    },
  };
  for (const [field,value,expected] of [
    ["sport","nfl","sport"],
    ["eventId","game-2","event_id"],
  ]) {
    const db=fakeDb({ evidenceForGrade:evidence });
    const out=await persistEconomicGrade({DB:db},{...base,[field]:value});
    assert.equal(out.ok,false);
    assert.equal(out.reason,"economic-grade-evidence-linkage-conflict");
    assert.ok(out.fields.includes(expected));
    assert.equal(db.writes.length,0);
  }
  for (const [field,value,expected] of [
    ["entryMarketSnapshotId","market-2","entry_market_snapshot_id"],
    ["entryObservedAt","2026-10-06T20:00:00.000Z","entry_observed_at"],
  ]) {
    const db=fakeDb({ evidenceForGrade:evidence });
    const out=await persistEconomicGrade({DB:db},{...base,metadata:{...base.metadata,[field]:value}});
    assert.equal(out.ok,false);
    assert.equal(out.reason,"economic-grade-evidence-linkage-conflict");
    assert.ok(out.fields.includes(expected));
    assert.equal(db.writes.length,0);
  }
});

test("behavior: correctly linked economic grade is accepted", async () => {
  const db=fakeDb({ evidenceForGrade:{
    evidence_id:"ev-1", sport:"mlb", event_id:"game-1",
    market_snapshot_id:"market-1", market_observed_at:"2026-10-06T19:59:00.000Z", promotion_eligible:0,
  }});
  const out=await persistEconomicGrade({DB:db},{
    gradeId:"g-linked", evidenceId:"ev-1", sport:"mlb", eventId:"game-1",
    marketFamily:"player-prop", selection:"OVER", entryPrice:-110, result:"WON",
    metadata:{
      entryMarketSnapshotId:"market-1", entryObservedAt:"2026-10-06T19:59:00.000Z",
      economicBasis:"SIMULATED_1U_PRICE_AVAILABLE", metricMethodVersion:"FBIS-ECONOMIC-GRADE-v1",
    },
  });
  assert.equal(out.ok,true);
  assert.equal(out.inserted,true);
  assert.equal(db.writes.length,1);
});
