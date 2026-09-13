/**
 * Immutable publication ledger.
 *
 * Publication is separate from wager qualification/authorization/execution.
 * Records are append-only; corrections create supersession rows, never overwrites.
 */

export const PUBLICATION_STATUS = Object.freeze({
  ELIGIBLE: "ELIGIBLE",
  PUBLISHED: "PUBLISHED",
  SUPERSEDED: "SUPERSEDED",
  BLOCKED: "BLOCKED",
  RESEARCH_ONLY: "RESEARCH_ONLY",
});

/**
 * Build an immutable publication record (conceptual + D1 row shape).
 */
export function buildPublicationRecord({
  publicationId = null,
  projectionId,
  modelId,
  modelVersion,
  sport,
  eventId = null,
  marketSnapshotId = null,
  publishedValue,
  destination = "internal",
  validationStatus = null,
  publicationStatus = PUBLICATION_STATUS.PUBLISHED,
  commercialStatus = null,
  supersedesPublicationId = null,
  publishedAt = null,
} = {}) {
  if (!projectionId || !modelId || publishedValue === undefined) {
    throw new Error("publication_record_incomplete");
  }
  const id =
    publicationId ||
    `pub_${sport || "x"}_${projectionId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return Object.freeze({
    publicationId: id,
    projectionId,
    modelId,
    modelVersion: modelVersion || null,
    sport: sport || null,
    eventId,
    marketSnapshotId,
    publishedValue,
    destination,
    validationStatus,
    publicationStatus,
    commercialStatus,
    supersedesPublicationId,
    publishedAt: publishedAt || new Date().toISOString(),
    immutable: true,
  });
}

/**
 * Supersede without mutating the prior record.
 */
export function supersedePublication(prior, nextPartial = {}) {
  if (!prior?.publicationId) throw new Error("prior_publication_required");
  if (prior.publicationStatus === PUBLICATION_STATUS.SUPERSEDED) {
    // Prior row conceptually remains SUPERSEDED; create a new leaf.
  }
  const next = buildPublicationRecord({
    ...nextPartial,
    // Always mint a new id — never reuse the prior publication identity.
    publicationId: null,
    projectionId: nextPartial.projectionId || prior.projectionId,
    modelId: nextPartial.modelId || prior.modelId,
    modelVersion: nextPartial.modelVersion || prior.modelVersion,
    sport: nextPartial.sport || prior.sport,
    eventId: nextPartial.eventId ?? prior.eventId,
    marketSnapshotId: nextPartial.marketSnapshotId ?? prior.marketSnapshotId,
    publishedValue: nextPartial.publishedValue,
    destination: nextPartial.destination || prior.destination,
    validationStatus: nextPartial.validationStatus ?? prior.validationStatus,
    publicationStatus: PUBLICATION_STATUS.PUBLISHED,
    commercialStatus: nextPartial.commercialStatus ?? prior.commercialStatus,
    supersedesPublicationId: prior.publicationId,
  });
  const priorSuperseded = Object.freeze({
    ...prior,
    publicationStatus: PUBLICATION_STATUS.SUPERSEDED,
  });
  return { prior: priorSuperseded, next };
}

/**
 * Publication eligibility is independent of wager authorization.
 */
export function publicationEligibility({
  projectionId = null,
  validationStatus = null,
  commercialStatus = null,
  researchOnly = false,
  rightsBlocked = false,
} = {}) {
  if (!projectionId) {
    return { eligible: false, status: PUBLICATION_STATUS.BLOCKED, reason: "missing-projection" };
  }
  if (rightsBlocked || commercialStatus === "BLOCKED") {
    return {
      eligible: false,
      status: PUBLICATION_STATUS.BLOCKED,
      reason: "commercial-rights-block",
    };
  }
  if (researchOnly || commercialStatus === "RESEARCH_ONLY" || commercialStatus === "COMMERCIAL_USE_REVIEW_REQUIRED") {
    return {
      eligible: true,
      status: PUBLICATION_STATUS.RESEARCH_ONLY,
      reason: "research-publication-ok-wager-gated",
      canQualify: false,
      canAuthorizeWager: false,
    };
  }
  return {
    eligible: true,
    status: PUBLICATION_STATUS.ELIGIBLE,
    reason: null,
    validationStatus,
    canQualify: false, // publication never implies qualification
    canAuthorizeWager: false,
  };
}

/** SQL helpers — insert only; never UPDATE published payload. */
export const PUBLICATION_LEDGER_INSERT_SQL = `
INSERT INTO canonical_publication_ledger (
  publication_id, projection_id, model_id, model_version, sport, event_id,
  market_snapshot_id, published_value_json, destination, validation_status,
  publication_status, commercial_status, supersedes_publication_id, published_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
