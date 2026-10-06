export const PROSPECTIVE_EVIDENCE_VERSION = "FBIS-PROSPECTIVE-EVIDENCE-v1";

export const PROSPECTIVE_LIFECYCLE = Object.freeze({
  CONTEXT_ONLY: "CONTEXT_ONLY",
  SHADOW: "SHADOW",
  PROMOTION_CANDIDATE: "PROMOTION_CANDIDATE",
  PRODUCTION_APPROVED: "PRODUCTION_APPROVED",
});

function iso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error("invalid_timestamp");
  return new Date(t).toISOString();
}

function beforeOrEqual(a, b) {
  if (!a || !b) return true;
  return Date.parse(a) <= Date.parse(b);
}

export function validateProspectiveTemporalIntegrity(row = {}) {
  const problems = [];
  const snapshotAt = row.snapshotAt || row.snapshot_at || null;
  const eventStartAt = row.eventStartAt || row.event_start_at || null;
  if (!snapshotAt) problems.push("MISSING_SNAPSHOT_AT");
  if (snapshotAt && eventStartAt && !beforeOrEqual(snapshotAt, eventStartAt)) {
    problems.push("POST_START_SNAPSHOT");
  }
  const sourceTimes = Array.isArray(row.sourceObservedAts)
    ? row.sourceObservedAts
    : Array.isArray(row.source_observed_ats)
      ? row.source_observed_ats
      : [];
  for (const t of sourceTimes.filter(Boolean)) {
    if (snapshotAt && !beforeOrEqual(t, snapshotAt)) problems.push("FUTURE_SOURCE_OBSERVATION");
  }
  const marketAt = row.marketObservedAt || row.market_observed_at || null;
  if (marketAt && snapshotAt && !beforeOrEqual(marketAt, snapshotAt)) {
    problems.push("FUTURE_MARKET_OBSERVATION");
  }
  return { ok: problems.length === 0, problems };
}

export function buildProspectiveEvidence({
  evidenceId,
  sport,
  eventId,
  eventStartAt = null,
  snapshotAt,
  championModelId,
  modelId,
  modelVersion = null,
  lifecycle = PROSPECTIVE_LIFECYCLE.SHADOW,
  gateVersion = null,
  stateSnapshotId = null,
  marketSnapshotId = null,
  marketObservedAt = null,
  sourceObservedAts = [],
  codeSha = null,
  stateSnapshot = null,
  marketSnapshot = null,
  uncertainty = null,
  incumbentProjection = null,
  challengerProjection = null,
  governance = {},
  qualificationAuthority = null,
  wagerAuthority = null,
  canQualify = false,
  canAuthorize = false,
  legacy = false,
} = {}) {
  if (!evidenceId || !sport || !eventId || !snapshotAt || !championModelId || !modelId) {
    throw new Error("prospective_evidence_incomplete");
  }
  const row = {
    version: PROSPECTIVE_EVIDENCE_VERSION,
    evidenceId: String(evidenceId),
    sport: String(sport).toLowerCase(),
    eventId: String(eventId),
    eventStartAt: iso(eventStartAt),
    snapshotAt: iso(snapshotAt),
    championModelId: String(championModelId),
    modelId: String(modelId),
    modelVersion: modelVersion || null,
    lifecycle,
    gateVersion: gateVersion || null,
    stateSnapshotId: stateSnapshotId || null,
    marketSnapshotId: marketSnapshotId || null,
    marketObservedAt: iso(marketObservedAt),
    sourceObservedAts: (sourceObservedAts || []).filter(Boolean).map(iso),
    codeSha: codeSha || null,
    stateSnapshot,
    marketSnapshot,
    uncertainty,
    incumbentProjection,
    challengerProjection,
    governance: { ...governance },
    qualificationAuthority,
    wagerAuthority,
    canQualify: canQualify === true,
    canAuthorize: canAuthorize === true,
    legacy: legacy === true,
  };
  const temporal = validateProspectiveTemporalIntegrity(row);
  return Object.freeze({ ...row, temporalIntegrity: temporal });
}

export function promotionCohortEligibility(row = {}, {
  gateVersion = null,
  minSnapshotAt = null,
  acceptedLifecycle = [PROSPECTIVE_LIFECYCLE.SHADOW, PROSPECTIVE_LIFECYCLE.PROMOTION_CANDIDATE],
} = {}) {
  const reasons = [];
  if (row.legacy === true) reasons.push("LEGACY_ROW");
  const mandatory = [
    ["eventStartAt", "MISSING_EVENT_START"],
    ["snapshotAt", "MISSING_SNAPSHOT_AT"],
    ["gateVersion", "MISSING_GATE_VERSION"],
    ["stateSnapshotId", "MISSING_STATE_SNAPSHOT_ID"],
    ["marketSnapshotId", "MISSING_MARKET_SNAPSHOT_ID"],
    ["marketObservedAt", "MISSING_MARKET_OBSERVED_AT"],
    ["codeSha", "MISSING_CODE_SHA"],
    ["stateSnapshot", "MISSING_STATE_SNAPSHOT"],
    ["marketSnapshot", "MISSING_MARKET_SNAPSHOT"],
    ["uncertainty", "MISSING_UNCERTAINTY"],
    ["incumbentProjection", "MISSING_INCUMBENT_PROJECTION"],
    ["challengerProjection", "MISSING_CHALLENGER_PROJECTION"],
    ["qualificationAuthority", "MISSING_QUALIFICATION_AUTHORITY"],
    ["wagerAuthority", "MISSING_WAGER_AUTHORITY"],
  ];
  for (const [field, reason] of mandatory) {
    if (row[field] == null) reasons.push(reason);
  }
  if (row.uncertainty && String(row.uncertainty.state || "").toUpperCase() === "UNKNOWN") {
    reasons.push("MISSING_UNCERTAINTY");
  }
  if (!Array.isArray(row.sourceObservedAts) || row.sourceObservedAts.length === 0) {
    reasons.push("MISSING_SOURCE_OBSERVATION_TIMES");
  }
  if (gateVersion && row.gateVersion !== gateVersion) reasons.push("WRONG_GATE_VERSION");
  if (minSnapshotAt && row.snapshotAt && Date.parse(row.snapshotAt) < Date.parse(minSnapshotAt)) {
    reasons.push("PRE_GATE_SNAPSHOT");
  }
  if (!acceptedLifecycle.includes(row.lifecycle)) reasons.push("WRONG_LIFECYCLE");
  const temporal = row.temporalIntegrity || validateProspectiveTemporalIntegrity(row);
  if (!temporal.ok) reasons.push(...temporal.problems);
  if (row.canAuthorize === true && row.lifecycle !== PROSPECTIVE_LIFECYCLE.PRODUCTION_APPROVED) {
    reasons.push("UNAPPROVED_WAGER_AUTHORITY");
  }
  return { eligible: reasons.length === 0, reasons };
}
