/**
 * Projection + lineage contract helpers (Model Family Standard).
 * effective_at <= information_cutoff < event_start
 */

/**
 * @param {object} partial
 * @returns {object} normalized projection contract (nulls explicit)
 */
export function buildProjectionContract(partial = {}) {
  return {
    eventId: partial.eventId ?? null,
    sport: partial.sport ?? null,
    modelId: partial.modelId ?? null,
    modelVersion: partial.modelVersion ?? null,
    generatedAt: partial.generatedAt ?? new Date().toISOString(),
    informationCutoff: partial.informationCutoff ?? null,
    featureSnapshotId: partial.featureSnapshotId ?? null,
    codeSha: partial.codeSha ?? null,
    datasetHash: partial.datasetHash ?? null,
    projectedHome: finiteOrNull(partial.projectedHome),
    projectedAway: finiteOrNull(partial.projectedAway),
    projectedMargin: finiteOrNull(partial.projectedMargin),
    projectedTotal: finiteOrNull(partial.projectedTotal),
    winProbability: finiteOrNull(partial.winProbability),
    uncertainty: partial.uncertainty ?? null,
    dataQuality: partial.dataQuality ?? null,
    qualityStatus: partial.qualityStatus ?? "UNKNOWN",
    family: partial.family ?? null,
    marketInformed: Boolean(partial.marketInformed),
    calibrationLocked: Boolean(partial.calibrationLocked),
    canQualify: Boolean(partial.canQualify),
    canAuthorizeWager: false,
  };
}

export function finiteOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Point-in-time rule: effective_at <= information_cutoff < event_start
 */
export function assertPointInTime({
  effectiveAt,
  informationCutoff,
  eventStart,
} = {}) {
  const eff = toMs(effectiveAt);
  const cut = toMs(informationCutoff);
  const start = toMs(eventStart);
  if (cut == null || start == null) {
    return {
      ok: false,
      reason: "missing-cutoff-or-event-start",
      rule: "effective_at <= information_cutoff < event_start",
    };
  }
  if (!(cut < start)) {
    return {
      ok: false,
      reason: "cutoff-not-before-event-start",
      rule: "effective_at <= information_cutoff < event_start",
    };
  }
  if (eff != null && !(eff <= cut)) {
    return {
      ok: false,
      reason: "effective-after-cutoff",
      rule: "effective_at <= information_cutoff < event_start",
    };
  }
  return { ok: true, reason: null, rule: "effective_at <= information_cutoff < event_start" };
}

function toMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Feature lineage record — provider → raw → normalized → feature → model.
 */
export function buildFeatureLineage({
  featureName,
  sport,
  modelFamily,
  providerId,
  rawField,
  normalizedField,
  transformVersion,
  window = null,
  missingRule = "NULL",
  timestampRule = "effective_at <= information_cutoff < event_start",
  status = "EVALUATION_ONLY",
  rationale = "",
} = {}) {
  return {
    featureName: featureName || null,
    sport: sport || null,
    modelFamily: modelFamily || null,
    providerId: providerId || null,
    rawField: rawField || null,
    normalizedField: normalizedField || null,
    transformVersion: transformVersion || null,
    window,
    missingRule,
    timestampRule,
    status,
    rationale,
  };
}

export function lineageBroken(lineage = {}) {
  const required = [
    "featureName",
    "providerId",
    "rawField",
    "normalizedField",
    "transformVersion",
    "status",
  ];
  const missing = required.filter((k) => !lineage[k]);
  return { broken: missing.length > 0, missing };
}
