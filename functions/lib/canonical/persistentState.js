export const PERSISTENT_STATE_VERSION = "FBIS-PERSISTENT-STATE-v1";

function iso(v, field) {
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`invalid_${field}`);
  return new Date(t).toISOString();
}

export function buildStateObservation({
  observationId,
  sport,
  entityType,
  entityId,
  stateFamily,
  value,
  source,
  evidenceClass = null,
  evidenceRank = 0,
  observedAt,
  effectiveAt = null,
  ingestedAt = null,
  expiresAt = null,
  supersedesObservationId = null,
  provenance = {},
  confidence = null,
} = {}) {
  if (!observationId || !sport || !entityType || !entityId || !stateFamily || !source || !observedAt) {
    throw new Error("state_observation_incomplete");
  }
  return Object.freeze({
    version: PERSISTENT_STATE_VERSION,
    observationId: String(observationId),
    sport: String(sport).toLowerCase(),
    entityType: String(entityType),
    entityId: String(entityId),
    stateFamily: String(stateFamily),
    value,
    source: String(source),
    evidenceClass: evidenceClass || null,
    evidenceRank: Number.isFinite(Number(evidenceRank)) ? Number(evidenceRank) : 0,
    observedAt: iso(observedAt, "observed_at"),
    effectiveAt: iso(effectiveAt || observedAt, "effective_at"),
    ingestedAt: iso(ingestedAt || new Date().toISOString(), "ingested_at"),
    expiresAt: iso(expiresAt, "expires_at"),
    supersedesObservationId: supersedesObservationId || null,
    provenance: { ...provenance },
    confidence: confidence == null ? null : Number(confidence),
  });
}

export function observationFreshness(observation = {}, { asOf = new Date().toISOString(), maxAgeMs = null } = {}) {
  const t = Date.parse(observation.effectiveAt || observation.observedAt || "");
  const a = Date.parse(asOf);
  if (!Number.isFinite(t) || !Number.isFinite(a)) return { fresh: false, reason: "INVALID_TIME", ageMs: null };
  if (observation.expiresAt && a > Date.parse(observation.expiresAt)) {
    return { fresh: false, reason: "EXPIRED", ageMs: a - t };
  }
  const ageMs = a - t;
  if (maxAgeMs != null && ageMs > Number(maxAgeMs)) return { fresh: false, reason: "STALE", ageMs };
  if (ageMs < 0) return { fresh: false, reason: "FUTURE_OBSERVATION", ageMs };
  return { fresh: true, reason: null, ageMs };
}

export function resolveCurrentState(observations = [], {
  asOf = new Date().toISOString(),
  maxAgeMs = null,
} = {}) {
  const eligible = observations
    .map((o) => ({ observation: o, freshness: observationFreshness(o, { asOf, maxAgeMs }) }))
    .filter((x) => x.freshness.fresh)
    .filter((x) => Date.parse(x.observation.effectiveAt || x.observation.observedAt) <= Date.parse(asOf));

  if (!eligible.length) return { current: null, carried: false, reason: "NO_FRESH_OBSERVATION" };

  eligible.sort((a, b) => {
    const rank = Number(b.observation.evidenceRank || 0) - Number(a.observation.evidenceRank || 0);
    if (rank) return rank;
    return Date.parse(b.observation.effectiveAt || b.observation.observedAt) -
      Date.parse(a.observation.effectiveAt || a.observation.observedAt);
  });

  const winner = eligible[0];
  const latestObservedAt = Math.max(...eligible.map((x) => Date.parse(x.observation.observedAt)));
  const carried = Date.parse(winner.observation.observedAt) < latestObservedAt;
  return {
    current: winner.observation,
    carried,
    reason: carried ? "STRONGER_PRIOR_EVIDENCE_CARRIED" : "CURRENT_EVIDENCE",
    freshness: winner.freshness,
  };
}

export function assertCompatibleStateFamily(observations = []) {
  const keys = new Set(observations.map((o) => [o.sport, o.entityType, o.entityId, o.stateFamily].join("|")));
  return keys.size <= 1;
}
