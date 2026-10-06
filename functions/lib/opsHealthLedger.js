const SEVERITIES = ["INFO", "WARN", "DEGRADED", "CRITICAL"];

function nowIso() {
  return new Date().toISOString();
}

function normalizeSeverity(value) {
  const v = String(value || "INFO").toUpperCase();
  return SEVERITIES.includes(v) ? v : "INFO";
}

export function deriveFreshnessState(component, health, now = Date.now()) {
  const parse = (v) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const freshnessCandidates = [
    health?.published_freshness_at,
    health?.database_freshness_at,
    health?.source_freshness_at,
    health?.workflow_freshness_at,
    health?.last_success_at,
  ].map(parse).filter((v) => v != null);
  const latest = freshnessCandidates.length ? Math.max(...freshnessCandidates) : null;
  const ageMinutes = latest == null ? null : Math.max(0, (now - latest) / 60000);
  const grace = Number(component?.grace_period_minutes);
  const stale = Number(component?.stale_after_minutes);
  const escalate = Number(component?.escalation_after_minutes);

  if (latest == null) {
    return { state: "UNKNOWN", severity: "WARN", ageMinutes: null, latestAt: null };
  }
  if (Number.isFinite(escalate) && ageMinutes >= escalate) {
    return { state: "STALE", severity: "CRITICAL", ageMinutes, latestAt: new Date(latest).toISOString() };
  }
  if (Number.isFinite(stale) && ageMinutes >= stale) {
    return { state: "STALE", severity: "DEGRADED", ageMinutes, latestAt: new Date(latest).toISOString() };
  }
  if (Number.isFinite(grace) && ageMinutes >= grace) {
    return { state: "LATE", severity: "WARN", ageMinutes, latestAt: new Date(latest).toISOString() };
  }
  return { state: "HEALTHY", severity: "INFO", ageMinutes, latestAt: new Date(latest).toISOString() };
}

export async function upsertOpsHealth(env, row) {
  if (!env?.DB?.prepare || !row?.componentId) return { ok: false, reason: "d1-unbound-or-component-missing" };
  const at = row.updatedAt || nowIso();
  await env.DB.prepare(
    `INSERT INTO fbis_ops_health (
      component_id, workflow_freshness_at, source_freshness_at, database_freshness_at,
      published_freshness_at, last_attempt_at, last_success_at, last_nonempty_at,
      last_persist_at, last_verified_at, source_rows, rows_written, rows_visible_downstream,
      status, severity, incident_fingerprint, consecutive_failures, consecutive_empty_successes,
      last_error_class, last_error, provider_run_id, workflow_run_id, deployment_sha,
      data_date_or_range, cost_or_quota_state, metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(component_id) DO UPDATE SET
      workflow_freshness_at=COALESCE(excluded.workflow_freshness_at, workflow_freshness_at),
      source_freshness_at=COALESCE(excluded.source_freshness_at, source_freshness_at),
      database_freshness_at=COALESCE(excluded.database_freshness_at, database_freshness_at),
      published_freshness_at=COALESCE(excluded.published_freshness_at, published_freshness_at),
      last_attempt_at=COALESCE(excluded.last_attempt_at, last_attempt_at),
      last_success_at=COALESCE(excluded.last_success_at, last_success_at),
      last_nonempty_at=COALESCE(excluded.last_nonempty_at, last_nonempty_at),
      last_persist_at=COALESCE(excluded.last_persist_at, last_persist_at),
      last_verified_at=COALESCE(excluded.last_verified_at, last_verified_at),
      source_rows=COALESCE(excluded.source_rows, source_rows),
      rows_written=COALESCE(excluded.rows_written, rows_written),
      rows_visible_downstream=COALESCE(excluded.rows_visible_downstream, rows_visible_downstream),
      status=excluded.status,
      severity=excluded.severity,
      incident_fingerprint=excluded.incident_fingerprint,
      consecutive_failures=excluded.consecutive_failures,
      consecutive_empty_successes=excluded.consecutive_empty_successes,
      last_error_class=excluded.last_error_class,
      last_error=excluded.last_error,
      provider_run_id=COALESCE(excluded.provider_run_id, provider_run_id),
      workflow_run_id=COALESCE(excluded.workflow_run_id, workflow_run_id),
      deployment_sha=COALESCE(excluded.deployment_sha, deployment_sha),
      data_date_or_range=COALESCE(excluded.data_date_or_range, data_date_or_range),
      cost_or_quota_state=COALESCE(excluded.cost_or_quota_state, cost_or_quota_state),
      metadata_json=COALESCE(excluded.metadata_json, metadata_json),
      updated_at=excluded.updated_at`
  ).bind(
    row.componentId,
    row.workflowFreshnessAt || null,
    row.sourceFreshnessAt || null,
    row.databaseFreshnessAt || null,
    row.publishedFreshnessAt || null,
    row.lastAttemptAt || null,
    row.lastSuccessAt || null,
    row.lastNonemptyAt || null,
    row.lastPersistAt || null,
    row.lastVerifiedAt || null,
    row.sourceRows ?? null,
    row.rowsWritten ?? null,
    row.rowsVisibleDownstream ?? null,
    row.status || "UNKNOWN",
    normalizeSeverity(row.severity),
    row.incidentFingerprint || null,
    Number(row.consecutiveFailures || 0),
    Number(row.consecutiveEmptySuccesses || 0),
    row.lastErrorClass || null,
    row.lastError || null,
    row.providerRunId || null,
    row.workflowRunId || null,
    row.deploymentSha || null,
    row.dataDateOrRange || null,
    row.costOrQuotaState || null,
    row.metadata ? JSON.stringify(row.metadata) : null,
    at
  ).run();
  return { ok: true };
}

export async function recordRunManifest(env, row) {
  if (!env?.DB?.prepare || !row?.runId || !row?.componentId) {
    return { ok: false, reason: "d1-unbound-or-run-missing" };
  }
  await env.DB.prepare(
    `INSERT OR REPLACE INTO fbis_run_manifests (
      run_id, component_id, workflow_run_id, provider_run_id, trigger_type,
      expected_range, expected_items, received_items, persisted_items, visible_items,
      rejected_items, duplicate_items, started_at, finished_at, status, error_class,
      error_summary, deployment_sha, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.runId,
    row.componentId,
    row.workflowRunId || null,
    row.providerRunId || null,
    row.triggerType || null,
    row.expectedRange || null,
    row.expectedItems ?? null,
    row.receivedItems ?? null,
    row.persistedItems ?? null,
    row.visibleItems ?? null,
    row.rejectedItems ?? null,
    row.duplicateItems ?? null,
    row.startedAt || null,
    row.finishedAt || null,
    row.status || "unknown",
    row.errorClass || null,
    row.errorSummary || null,
    row.deploymentSha || null,
    row.metadata ? JSON.stringify(row.metadata) : null
  ).run();
  return { ok: true };
}

export async function recordInvariantCheck(env, row) {
  if (!env?.DB?.prepare || !row?.invariantKey) return { ok: false, reason: "d1-unbound-or-key-missing" };
  await env.DB.prepare(
    `INSERT INTO fbis_ops_invariant_checks (
      invariant_key, component_id, checked_at, status, expected_value, actual_value,
      detail, incident_fingerprint, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.invariantKey,
    row.componentId || null,
    row.checkedAt || nowIso(),
    row.status || "UNKNOWN",
    row.expectedValue == null ? null : String(row.expectedValue),
    row.actualValue == null ? null : String(row.actualValue),
    row.detail || null,
    row.incidentFingerprint || null,
    row.metadata ? JSON.stringify(row.metadata) : null
  ).run();
  return { ok: true };
}

export async function recordWatchdogMetric(env, row) {
  if (!env?.DB?.prepare || !row?.incidentFingerprint) return { ok: false, reason: "d1-unbound-or-fingerprint-missing" };
  const detectedAt = row.detectedAt || nowIso();
  const repairedAt = row.repairedAt || null;
  const mttrSeconds = repairedAt ? Math.max(0, Math.round((Date.parse(repairedAt) - Date.parse(detectedAt)) / 1000)) : null;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO fbis_watchdog_metrics (
      incident_fingerprint, component_id, failure_class, severity, detected_at,
      repaired_at, verified_at, detection_source, autonomous_repair,
      owner_action_required, repeat_count, mttr_seconds, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.incidentFingerprint,
    row.componentId || null,
    row.failureClass || null,
    normalizeSeverity(row.severity),
    detectedAt,
    repairedAt,
    row.verifiedAt || null,
    row.detectionSource || null,
    row.autonomousRepair ? 1 : 0,
    row.ownerActionRequired ? 1 : 0,
    Number(row.repeatCount || 1),
    mttrSeconds,
    row.notes || null
  ).run();
  return { ok: true };
}

export async function loadOpsControlPlane(env) {
  if (!env?.DB?.prepare) return { bound: false, components: [], invariants: [], metrics: {} };
  const componentsRes = await env.DB.prepare(
    `SELECT c.*, h.workflow_freshness_at, h.source_freshness_at, h.database_freshness_at,
            h.published_freshness_at, h.last_attempt_at, h.last_success_at, h.last_nonempty_at,
            h.last_persist_at, h.last_verified_at, h.source_rows, h.rows_written,
            h.rows_visible_downstream, h.status AS health_status, h.severity,
            h.incident_fingerprint, h.consecutive_failures, h.consecutive_empty_successes,
            h.last_error_class, h.last_error, h.provider_run_id, h.workflow_run_id,
            h.deployment_sha, h.data_date_or_range, h.cost_or_quota_state, h.updated_at AS health_updated_at
       FROM fbis_ops_components c
       LEFT JOIN fbis_ops_health h ON h.component_id = c.component_id
      WHERE c.enabled = 1
      ORDER BY c.criticality DESC, c.component_id`
  ).all();
  const components = (componentsRes?.results || []).map((row) => {
    const freshness = deriveFreshnessState(row, row);
    return { ...row, freshness };
  });

  const invRes = await env.DB.prepare(
    `SELECT invariant_key, component_id, checked_at, status, expected_value, actual_value, detail
       FROM fbis_ops_invariant_checks
      WHERE checked_at >= datetime('now', '-24 hours')
      ORDER BY checked_at DESC
      LIMIT 100`
  ).all();

  const manifestsRes = await env.DB.prepare(
    `SELECT run_id, component_id, expected_items, received_items, persisted_items,
            visible_items, rejected_items, duplicate_items, status, started_at, finished_at
       FROM fbis_run_manifests
      ORDER BY COALESCE(finished_at, started_at, created_at) DESC
      LIMIT 50`
  ).all();
  const manifestInvariants = [];
  for (const manifest of manifestsRes?.results || []) {
    for (const check of evaluateManifestInvariants(manifest)) {
      manifestInvariants.push({
        invariant_key: `manifest:${check.key}`,
        component_id: manifest.component_id,
        checked_at: manifest.finished_at || manifest.started_at || null,
        status: check.ok ? "PASS" : "FAIL",
        expected_value: check.expected == null ? null : String(check.expected),
        actual_value: check.actual == null ? null : String(check.actual),
        detail: check.detail,
        run_id: manifest.run_id,
      });
    }
  }

  const metric = await env.DB.prepare(
    `SELECT
       COUNT(*) AS incidents,
       SUM(CASE WHEN autonomous_repair = 1 THEN 1 ELSE 0 END) AS autonomous_repairs,
       SUM(CASE WHEN owner_action_required = 1 THEN 1 ELSE 0 END) AS owner_actions,
       AVG(CASE WHEN mttr_seconds IS NOT NULL THEN mttr_seconds END) AS avg_mttr_seconds,
       SUM(CASE WHEN detection_source = 'proactive' THEN 1 ELSE 0 END) AS proactive_detections
       FROM fbis_watchdog_metrics
       WHERE detected_at >= datetime('now', '-30 days')`
  ).first();

  const incidentsRes = await env.DB.prepare(
    `SELECT incident_fingerprint, component_id, failure_class, severity, detected_at,
            repaired_at, verified_at, detection_source, autonomous_repair,
            owner_action_required, repeat_count, mttr_seconds, notes
       FROM fbis_watchdog_metrics
      ORDER BY detected_at DESC
      LIMIT 50`
  ).all();

  return {
    bound: true,
    components,
    incidents: incidentsRes?.results || [],
    invariants: [...manifestInvariants, ...(invRes?.results || [])].slice(0, 150),
    metrics: {
      incidents: Number(metric?.incidents || 0),
      autonomousRepairs: Number(metric?.autonomous_repairs || 0),
      ownerActions: Number(metric?.owner_actions || 0),
      avgMttrSeconds: metric?.avg_mttr_seconds == null ? null : Number(metric.avg_mttr_seconds),
      proactiveDetections: Number(metric?.proactive_detections || 0),
    },
  };
}


export function evaluateManifestInvariants(manifest) {
  const checks = [];
  const status = String(manifest?.status || "").toLowerCase();
  const expected = manifest?.expected_items == null ? null : Number(manifest.expected_items);
  const received = manifest?.received_items == null ? null : Number(manifest.received_items);
  const persisted = manifest?.persisted_items == null ? null : Number(manifest.persisted_items);
  const visible = manifest?.visible_items == null ? null : Number(manifest.visible_items);
  const rejected = manifest?.rejected_items == null ? 0 : Number(manifest.rejected_items);

  if (expected != null && received != null) {
    checks.push({
      key: "expected-received",
      ok: received >= expected,
      expected,
      actual: received,
      detail: received >= expected ? "received meets expected population" : "received population is incomplete",
    });
  }
  if (received != null && persisted != null) {
    checks.push({
      key: "received-persisted",
      ok: persisted + rejected <= received && (status !== "success" || persisted + rejected === received),
      expected: received,
      actual: persisted + rejected,
      detail: "persisted + rejected must reconcile to received on successful runs",
    });
  }
  if (persisted != null && visible != null) {
    checks.push({
      key: "persisted-visible",
      ok: visible <= persisted && (status !== "success" || persisted === 0 || visible > 0),
      expected: persisted,
      actual: visible,
      detail: "downstream visibility cannot exceed persistence; successful non-empty runs must expose data",
    });
  }
  if (status === "success" && received != null) {
    checks.push({
      key: "success-nonempty",
      ok: received === 0 ? expected === 0 : persisted == null || persisted > 0 || rejected === received,
      expected: "meaningful persisted/rejected accounting",
      actual: `received=${received},persisted=${persisted},rejected=${rejected}`,
      detail: "green workflow cannot hide an unexplained zero-persist result",
    });
  }
  return checks;
}
