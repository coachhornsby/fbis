/**
 * Observability envelope for production endpoints. Never includes secrets.
 */

export function endpointTelemetry({
  endpoint,
  source = "d1",
  freshness = null,
  requestId = null,
  durationMs = null,
  cacheHit = null,
  d1QueryCount = null,
  rowsRead = null,
  externalSubrequests = null,
  partialFailures = [],
  authoritativeCounts = {},
  buildSha = null,
  semanticHealth = null,
} = {}) {
  return {
    endpoint,
    semanticHealth: semanticHealth || null,
    source,
    freshness,
    requestId: requestId || null,
    durationMs: durationMs == null ? null : Number(durationMs),
    cacheHit: cacheHit == null ? null : Boolean(cacheHit),
    d1QueryCount: d1QueryCount == null ? null : Number(d1QueryCount),
    rowsRead: rowsRead == null ? null : Number(rowsRead),
    externalSubrequests: externalSubrequests == null ? null : Number(externalSubrequests),
    partialFailures: Array.isArray(partialFailures) ? partialFailures.filter(Boolean) : [],
    authoritativeCounts: authoritativeCounts || {},
    buildSha: buildSha || null,
  };
}

export function scheduledProofNote({
  collectState,
  harvestState,
  lastEventType,
  lastRunUrl,
  durableScheduleRow = false,
} = {}) {
  const eventIsSchedule = lastEventType === "schedule";
  if (durableScheduleRow && eventIsSchedule && lastRunUrl) {
    return "GitHub event=schedule and a durable D1 trigger_type=schedule row agree. Workflow HTTP success without a D1 row is not proof.";
  }
  if ((collectState === "healthy" || harvestState === "healthy") && !durableScheduleRow) {
    return "Schedule timestamps look healthy, but durable D1 trigger_type=schedule proof is unverified. GitHub success alone is not collection proof.";
  }
  if (eventIsSchedule && !durableScheduleRow) {
    return "Last GitHub event is schedule, but no matching durable D1 schedule row was read back.";
  }
  if (!eventIsSchedule && durableScheduleRow) {
    return "A durable D1 schedule row exists; the last recorded GitHub event type is not schedule. Treat them as distinct signals.";
  }
  return "Scheduled pipeline proof requires event=schedule, workflow success, expected SHA, and a later independent D1 readback.";
}
