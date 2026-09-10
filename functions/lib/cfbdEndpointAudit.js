/**
 * Read-only CFBD endpoint audit.
 * Never logs, persists, or returns the API key. Safe diagnostics only.
 */

import { collegeApiKey, assertNoSecretLeak, redactSecrets } from "./collegeSecrets.js";
import { CFBD_BASE, unwrapCollegeResponse } from "./collegeApi.js";
import {
  CFBD_ENDPOINT_PROBES,
  CFBD_AUDIT_SOURCE_VERSION,
  AUDIT_KNOWN_WEEK,
} from "../../data/cfbd/endpoint-probe-plan.js";
import { hashPayload } from "./collegeIdentity.js";

export const AUDIT_CLASS = {
  AVAILABLE: "AVAILABLE",
  AVAILABLE_BUT_EMPTY: "AVAILABLE-BUT-EMPTY",
  NOT_ENTITLED: "NOT-ENTITLED",
  DEPRECATED: "DEPRECATED",
  INVALID_PARAMETERS: "INVALID-PARAMETERS",
  AUTH_FAILURE: "AUTH-FAILURE",
  TRANSIENT_FAILURE: "TRANSIENT-FAILURE",
  NO_KEY: "AUTH-FAILURE",
};

function sampleFieldNames(data) {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== "object") return [];
  const top = Object.keys(sample).sort().slice(0, 40);
  const nested = [];
  for (const [k, v] of Object.entries(sample)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const nk of Object.keys(v).sort().slice(0, 12)) nested.push(`${k}.${nk}`);
    }
  }
  return [...top, ...nested.slice(0, 24)];
}

function topLevelType(data) {
  if (data == null) return "null";
  if (Array.isArray(data)) return "array";
  return typeof data;
}

function rowCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return 1;
  return 0;
}

export function classifyAuditStatus({ httpStatus, ok, rowCount: n, error, reason } = {}) {
  const status = Number(httpStatus) || 0;
  const msg = String(error || reason || "").toLowerCase();
  if (status === 0 && /no-api-key|missing.?key|auth/.test(msg)) return AUDIT_CLASS.AUTH_FAILURE;
  if (status === 401) return AUDIT_CLASS.AUTH_FAILURE;
  if (status === 403) {
    if (/entitlement|upgrade|patreon|subscription|plan|tier/.test(msg) || !msg) return AUDIT_CLASS.NOT_ENTITLED;
    return AUDIT_CLASS.NOT_ENTITLED;
  }
  if (status === 402 || /entitlement|upgrade|patreon|subscription/.test(msg)) return AUDIT_CLASS.NOT_ENTITLED;
  if (status === 404 || /deprecat/.test(msg)) return status === 404 ? AUDIT_CLASS.DEPRECATED : AUDIT_CLASS.DEPRECATED;
  if (status === 400 || status === 422) return AUDIT_CLASS.INVALID_PARAMETERS;
  if (status === 429 || status >= 500) return AUDIT_CLASS.TRANSIENT_FAILURE;
  if (ok && n === 0) return AUDIT_CLASS.AVAILABLE_BUT_EMPTY;
  if (ok) return AUDIT_CLASS.AVAILABLE;
  if (status === 404) return AUDIT_CLASS.DEPRECATED;
  return AUDIT_CLASS.TRANSIENT_FAILURE;
}

function safeDiag(row) {
  return {
    endpoint: row.endpoint,
    family: row.family || null,
    httpStatus: row.httpStatus ?? 0,
    ok: Boolean(row.ok),
    rowCount: Number(row.rowCount) || 0,
    latencyMs: Number(row.latencyMs) || 0,
    topLevelType: row.topLevelType || "null",
    sampleFieldNames: Array.isArray(row.sampleFieldNames) ? row.sampleFieldNames.slice(0, 48) : [],
    seasonTested: row.seasonTested ?? null,
    weekTested: row.weekTested ?? null,
    classification: row.classification || null,
    error: row.error ? String(row.error).slice(0, 240) : null,
    note: row.note || null,
  };
}

/**
 * Low-level authenticated GET that never caches and never returns the bearer.
 */
export async function probeCfbdEndpoint(path, env = {}, { query = {}, fetchFn = fetch } = {}) {
  const key = collegeApiKey(env, "cfbd");
  const started = Date.now();
  if (!key) {
    return {
      ok: false,
      httpStatus: 0,
      data: null,
      latencyMs: Date.now() - started,
      error: "no-api-key",
      classification: AUDIT_CLASS.AUTH_FAILURE,
    };
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  const url = `${CFBD_BASE}${path}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const latencyMs = Date.now() - started;
    let json = null;
    let parseError = null;
    try {
      json = await res.json();
    } catch (err) {
      parseError = String(err?.message || err);
      json = null;
    }
    if (parseError && res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        data: null,
        latencyMs,
        error: `malformed-json:${parseError}`,
        classification: AUDIT_CLASS.TRANSIENT_FAILURE,
      };
    }
    const unwrapped = unwrapCollegeResponse(json);
    const data = unwrapped.data;
    const n = rowCount(data);
    const ok = res.ok && !unwrapped.error;
    const error = !res.ok
      ? unwrapped.error || `HTTP ${res.status}`
      : unwrapped.error || null;
    const classification = classifyAuditStatus({
      httpStatus: res.status,
      ok,
      rowCount: n,
      error,
    });
    return { ok, httpStatus: res.status, data, latencyMs, error, classification, n };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      data: null,
      latencyMs: Date.now() - started,
      error: String(err?.message || err).slice(0, 240),
      classification: AUDIT_CLASS.TRANSIENT_FAILURE,
    };
  }
}

export async function runCfbdEndpointAudit(env = {}, opts = {}) {
  const {
    seasons = [2026, 2025],
    week = AUDIT_KNOWN_WEEK.week,
    probes = CFBD_ENDPOINT_PROBES,
    fetchFn = fetch,
    jobRunId = null,
  } = opts;

  const configured = Boolean(collegeApiKey(env, "cfbd"));
  const endpoints = [];
  const byEndpoint = {};

  for (const season of seasons) {
    for (const probe of probes) {
      const useWeek = probe.requiresWeek ? week : null;
      // For current unfinished season, week-scoped probes also try known completed week from prior season.
      const seasonForWeek = probe.requiresWeek && season === 2026 ? AUDIT_KNOWN_WEEK.season : season;
      const weekForQuery = probe.requiresWeek ? week : null;
      const querySeason = probe.requiresWeek ? seasonForWeek : season;
      const query = probe.query(querySeason, weekForQuery);
      const res = await probeCfbdEndpoint(probe.endpoint, env, { query, fetchFn });
      const diag = safeDiag({
        endpoint: probe.endpoint,
        family: probe.family,
        httpStatus: res.httpStatus,
        ok: res.ok,
        rowCount: res.n ?? rowCount(res.data),
        latencyMs: res.latencyMs,
        topLevelType: topLevelType(res.data),
        sampleFieldNames: sampleFieldNames(res.data),
        seasonTested: query.year ?? querySeason ?? season,
        weekTested: query.week ?? useWeek,
        classification: res.classification,
        error: res.error,
        note: probe.note || (probe.aliasOf ? `alias-of:${probe.aliasOf}` : null),
      });
      endpoints.push(diag);
      const prev = byEndpoint[probe.endpoint];
      if (!prev || (diag.ok && !prev.ok) || (diag.rowCount > (prev.rowCount || 0))) {
        byEndpoint[probe.endpoint] = diag;
      }
    }
  }

  const counts = Object.fromEntries(Object.values(AUDIT_CLASS).filter((v, i, a) => a.indexOf(v) === i).map((c) => [c, 0]));
  for (const row of endpoints) {
    counts[row.classification] = (counts[row.classification] || 0) + 1;
  }

  const summary = {
    source: "cfbd",
    base: CFBD_BASE,
    sourceVersion: CFBD_AUDIT_SOURCE_VERSION,
    configured,
    seasonsTested: seasons,
    weekTested: week,
    knownWeek: AUDIT_KNOWN_WEEK,
    probeCount: probes.length,
    resultCount: endpoints.length,
    uniqueEndpoints: Object.keys(byEndpoint).length,
    classifications: counts,
    available: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.AVAILABLE).map((r) => r.endpoint),
    availableButEmpty: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.AVAILABLE_BUT_EMPTY).map((r) => r.endpoint),
    notEntitled: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.NOT_ENTITLED).map((r) => r.endpoint),
    deprecatedOrMissing: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.DEPRECATED).map((r) => r.endpoint),
    authFailure: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.AUTH_FAILURE).map((r) => r.endpoint),
    invalidParameters: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.INVALID_PARAMETERS).map((r) => r.endpoint),
    transientFailure: Object.values(byEndpoint).filter((r) => r.classification === AUDIT_CLASS.TRANSIENT_FAILURE).map((r) => r.endpoint),
    jobRunId,
    auditedAt: new Date().toISOString(),
  };

  const report = {
    ok: configured,
    job: "cfbd-endpoint-audit",
    summary,
    endpoints,
    byEndpoint,
  };

  assertNoSecretLeak(report, env);
  return redactSecrets(report);
}

export function auditArtifactPayload(report) {
  const compact = {
    summary: report.summary,
    endpoints: (report.endpoints || []).map(safeDiag),
  };
  assertNoSecretLeak(compact);
  return compact;
}

export async function auditContentHash(report) {
  return hashPayload({
    endpoints: (report.endpoints || []).map((e) => ({
      endpoint: e.endpoint,
      httpStatus: e.httpStatus,
      classification: e.classification,
      rowCount: e.rowCount,
      seasonTested: e.seasonTested,
      weekTested: e.weekTested,
      sampleFieldNames: e.sampleFieldNames,
    })),
  });
}

export { safeDiag, sampleFieldNames, rowCount, topLevelType };
