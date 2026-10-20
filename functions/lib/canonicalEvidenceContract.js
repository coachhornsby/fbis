/**
 * Canonical evidence ownership for sport D1 migration.
 *
 * PRIMARY remains the canonical store for full prediction / published evidence
 * until an explicit cutover receipt authorizes sport authority.
 * Sport D1s hold a bounded working-set materialization plus an evidence envelope
 * (`payload_json`) so consumers can detect incomplete shards.
 */
export const CANONICAL_EVIDENCE_CONTRACT = "fbis-canonical-evidence-v1";

/** Fields sport shards must materialize as typed columns for board heads. */
export const SPORT_MATERIALIZATION_PRED_FIELDS = Object.freeze([
  "id", "game_id", "sport", "model_version", "projection_kind",
  "proj_total", "proj_home", "proj_away", "proj_margin",
  "p_home_final", "p_market", "frozen_at",
  "weights_json", "layers_json", "projection_flags",
  "graded_at", "actual_home", "actual_away", "deployment_commit",
  "payload_json",
]);

/** Fields that remain PRIMARY-canonical even after sport materialization. */
export const PRIMARY_CANONICAL_ONLY_PRED_FIELDS = Object.freeze([
  "date", "matchup", "checkpoint",
  "pal_home", "pal_away", "pal_f5_home", "pal_f5_away", "pal_p_home",
  "pal_as_of", "pal_request_id", "pal_json", "lineups_official",
  "p_espn", "p_score", "p_form", "p_pal",
  "data_quality", "pin_home_ml", "pin_away_ml", "pin_vig", "engine",
  "f5_actual_home", "f5_actual_away", "projection_state",
]);

export const SPORT_MATERIALIZATION_PUBLISHED_FIELDS = Object.freeze([
  "id", "game_id", "sport", "model_version", "published_at",
  "published_by", "payload_hash", "payload_json",
]);

export function canonicalEvidenceManifest() {
  return {
    contract: CANONICAL_EVIDENCE_CONTRACT,
    authority: {
      productReads: "PRIMARY",
      sportShardRole: "BOUNDED_WORKING_SET_MATERIALIZATION",
      evidenceEnvelope: "prediction_snapshots.payload_json / published_projections.payload_json",
    },
    predictionSnapshots: {
      materializeOnSport: SPORT_MATERIALIZATION_PRED_FIELDS,
      remainPrimaryCanonical: PRIMARY_CANONICAL_ONLY_PRED_FIELDS,
    },
    publishedProjections: {
      materializeOnSport: SPORT_MATERIALIZATION_PUBLISHED_FIELDS,
    },
    promotionRules: Object.freeze([
      "Count parity alone is insufficient",
      "Materialized typed fields + payload_json envelope must reconcile",
      "PRIMARY remains product authority until SPORT_DB_MODE=sport AND cutover receipt",
      "Board/model/grading consumers must be validated against full evidence before promotion",
    ]),
    canAuthorizeWager: false,
  };
}

/**
 * Build the sport-side evidence envelope from a primary prediction row.
 * `row` must be the complete PRIMARY source record (or the fullest SELECT available).
 * Fields listed in PRIMARY_CANONICAL_ONLY_PRED_FIELDS remain PRIMARY-owned even when
 * present in the envelope — sport shards must not treat them as cutover authority.
 */
export function buildPredictionEvidenceEnvelope(row = {}) {
  const sourceKeys = Object.keys(row || {});
  const retainedOnPrimary = PRIMARY_CANONICAL_ONLY_PRED_FIELDS.filter((f) => sourceKeys.includes(f));
  const missingFromSource = PRIMARY_CANONICAL_ONLY_PRED_FIELDS.filter((f) => !sourceKeys.includes(f));
  return JSON.stringify({
    contract: CANONICAL_EVIDENCE_CONTRACT,
    source: "PRIMARY",
    capturedAt: new Date().toISOString(),
    ownership: {
      productAuthority: "PRIMARY",
      materializedOnSport: SPORT_MATERIALIZATION_PRED_FIELDS,
      remainPrimaryCanonical: PRIMARY_CANONICAL_ONLY_PRED_FIELDS,
      retainedOnPrimaryInEnvelope: retainedOnPrimary,
      primaryCanonicalAbsentFromSourceSelect: missingFromSource,
      note: "PRIMARY remains canonical for remainPrimaryCanonical fields until an approved cutover receipt",
    },
    row,
  });
}

export function parsePredictionEvidenceEnvelope(payloadJson) {
  if (!payloadJson) return { ok: false, reason: "EVIDENCE_ENVELOPE_MISSING" };
  try {
    const parsed = JSON.parse(payloadJson);
    if (parsed?.contract !== CANONICAL_EVIDENCE_CONTRACT || !parsed?.row) {
      return { ok: false, reason: "EVIDENCE_ENVELOPE_INVALID" };
    }
    return { ok: true, envelope: parsed };
  } catch {
    return { ok: false, reason: "EVIDENCE_ENVELOPE_PARSE_FAILED" };
  }
}

/**
 * Fail-closed check: sport row is incomplete for promotion when required
 * materialization fields or evidence envelope are absent.
 * Lean primary copies may leave weights/layers null on typed columns when the
 * full primary row is recoverable from the evidence envelope.
 */
export function evaluateSportPredictionFidelity(sportRow = {}, { requireEnvelope = true } = {}) {
  const missing = [];
  for (const field of [
    "id", "game_id", "sport", "frozen_at", "p_home_final",
    "proj_home", "proj_away",
  ]) {
    if (sportRow[field] == null || sportRow[field] === "") missing.push(field);
  }
  const envelope = parsePredictionEvidenceEnvelope(sportRow.payload_json);
  if (requireEnvelope && !envelope.ok) missing.push(`payload_json:${envelope.reason}`);
  const evidenceRow = envelope.ok ? (envelope.envelope.row || {}) : {};
  for (const field of ["weights_json", "layers_json"]) {
    const typed = sportRow[field];
    const fromEnvelope = evidenceRow[field];
    if ((typed == null || typed === "") && (fromEnvelope == null || fromEnvelope === "")) {
      missing.push(field);
    }
  }
  return {
    contract: CANONICAL_EVIDENCE_CONTRACT,
    ok: missing.length === 0,
    missing,
    canPromote: false,
    canAuthorizeWager: false,
  };
}
