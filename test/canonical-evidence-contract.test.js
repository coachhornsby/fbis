import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEvidenceManifest,
  buildPredictionEvidenceEnvelope,
  parsePredictionEvidenceEnvelope,
  evaluateSportPredictionFidelity,
  CANONICAL_EVIDENCE_CONTRACT,
} from "../functions/lib/canonicalEvidenceContract.js";

test("canonical evidence contract keeps primary as product authority", () => {
  const m = canonicalEvidenceManifest();
  assert.equal(m.contract, CANONICAL_EVIDENCE_CONTRACT);
  assert.equal(m.authority.productReads, "PRIMARY");
  assert.ok(m.predictionSnapshots.materializeOnSport.includes("weights_json"));
  assert.ok(m.predictionSnapshots.remainPrimaryCanonical.includes("pal_json"));
});

test("evidence envelope round-trips primary row with ownership contract", () => {
  const row = {
    id: "p1", weights_json: "{}", layers_json: "{}", graded_at: null,
    pal_json: "{\"x\":1}", engine: "v2",
  };
  const json = buildPredictionEvidenceEnvelope(row);
  const parsed = parsePredictionEvidenceEnvelope(json);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.row.id, "p1");
  assert.equal(parsed.envelope.ownership.productAuthority, "PRIMARY");
  assert.ok(parsed.envelope.ownership.retainedOnPrimaryInEnvelope.includes("pal_json"));
  assert.ok(parsed.envelope.ownership.remainPrimaryCanonical.includes("pal_json"));
});

test("sport prediction fidelity fails without evidence fields", () => {
  const incomplete = evaluateSportPredictionFidelity({
    id: "p1", game_id: "g1", sport: "nfl", frozen_at: "t", p_home_final: 0.5,
    proj_home: 1, proj_away: 1,
  });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.missing.some((m) => String(m).includes("weights_json") || String(m).includes("payload_json")));

  const envelope = buildPredictionEvidenceEnvelope({ id: "p1", weights_json: "{}", layers_json: "{}" });
  const complete = evaluateSportPredictionFidelity({
    id: "p1", game_id: "g1", sport: "nfl", frozen_at: "t", p_home_final: 0.5,
    proj_home: 1, proj_away: 1, weights_json: "{}", layers_json: "{}",
    payload_json: envelope,
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.canPromote, false);
});

test("lean sport copy passes fidelity when envelope carries weights/layers", () => {
  const envelope = buildPredictionEvidenceEnvelope({
    id: "p1", game_id: "g1", sport: "nfl", frozen_at: "t",
    p_home_final: 0.5, proj_home: 1, proj_away: 1,
    weights_json: "{\"w\":1}", layers_json: "{\"l\":1}",
  });
  const lean = evaluateSportPredictionFidelity({
    id: "p1", game_id: "g1", sport: "nfl", frozen_at: "t",
    p_home_final: 0.5, proj_home: 1, proj_away: 1,
    weights_json: null, layers_json: null,
    payload_json: envelope,
  });
  assert.equal(lean.ok, true);
});
