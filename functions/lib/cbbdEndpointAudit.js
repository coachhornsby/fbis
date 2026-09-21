/**
 * Read-only CBBD capability and historical-depth audit.
 * Discovers the provider's live OpenAPI GET surface, then performs a bounded
 * set of authenticated probes through the normal CBBD client.
 *
 * Never returns or logs bearer credentials. No model state is changed.
 */

import { CBBD_BASE, cbbdGet } from "./collegeApi.js";
import { collegeApiKey, assertNoSecretLeak, redactSecrets } from "./collegeSecrets.js";

export const CBBD_AUDIT_CLASS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  AVAILABLE_BUT_EMPTY: "AVAILABLE-BUT-EMPTY",
  NOT_ENTITLED: "NOT-ENTITLED",
  INVALID_PARAMETERS: "INVALID-PARAMETERS",
  AUTH_FAILURE: "AUTH-FAILURE",
  TRANSIENT_FAILURE: "TRANSIENT-FAILURE",
  SKIPPED_PATH_ID: "SKIPPED-REQUIRES-PATH-ID",
  SKIPPED_REQUIRED_PARAM: "SKIPPED-UNSUPPORTED-REQUIRED-PARAM",
  NOT_PROBED: "NOT-PROBED",
});

function resolveRef(spec, value) {
  if (!value?.$ref) return value;
  const prefix = "#/components/parameters/";
  const ref = String(value.$ref);
  if (!ref.startsWith(prefix)) return value;
  return spec?.components?.parameters?.[ref.slice(prefix.length)] || value;
}

function paramsFor(spec, pathItem, op) {
  return [...(pathItem?.parameters || []), ...(op?.parameters || [])]
    .map((p) => resolveRef(spec, p))
    .filter(Boolean);
}

function sampleFields(data) {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== "object") return [];
  const top = Object.keys(sample).sort().slice(0, 50);
  const nested = [];
  for (const [key, value] of Object.entries(sample)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nestedKey of Object.keys(value).sort().slice(0, 12)) {
        nested.push(`${key}.${nestedKey}`);
      }
    }
  }
  return [...top, ...nested.slice(0, 30)];
}

function classify(res) {
  const status = Number(res?.status) || 0;
  const reason = String(res?.reason || "").toLowerCase();
  if (status === 401 || /auth|api.?key|token/.test(reason)) return CBBD_AUDIT_CLASS.AUTH_FAILURE;
  if (status === 402 || status === 403 || /entitl|upgrade|subscription|plan|tier/.test(reason)) {
    return CBBD_AUDIT_CLASS.NOT_ENTITLED;
  }
  if (status === 400 || status === 404 || status === 422) return CBBD_AUDIT_CLASS.INVALID_PARAMETERS;
  if (status === 429 || status >= 500 || status === 0) return CBBD_AUDIT_CLASS.TRANSIENT_FAILURE;
  if (res?.ok && Number(res?.n || 0) === 0) return CBBD_AUDIT_CLASS.AVAILABLE_BUT_EMPTY;
  if (res?.ok) return CBBD_AUDIT_CLASS.AVAILABLE;
  return CBBD_AUDIT_CLASS.TRANSIENT_FAILURE;
}

function seasonWindow(season) {
  return {
    start: `${season}-11-01T00:00:00Z`,
    weekEnd: `${season}-11-08T23:59:59Z`,
    end: `${season + 1}-04-15T23:59:59Z`,
    date: `${season + 1}-01-15`,
  };
}

function knownParamValue(name, season) {
  const w = seasonWindow(season);
  const map = {
    season,
    year: season,
    team: "Duke",
    conference: "ACC",
    seasonType: "regular",
    startDateRange: w.start,
    endDateRange: w.weekEnd,
    startDate: w.start,
    endDate: w.weekEnd,
    date: w.date,
    shootingPlaysOnly: false,
    conferenceOnly: false,
    tournament: "NCAA",
    limit: 50,
    page: 1,
  };
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
}

function buildQuery(params, season) {
  const query = {};
  const queryParams = params.filter((p) => p?.in === "query");
  const names = new Set(queryParams.map((p) => p.name));
  const unsupportedRequired = [];

  for (const p of queryParams) {
    if (!p.required) continue;
    const value = knownParamValue(p.name, season);
    if (value === undefined) unsupportedRequired.push(p.name);
  }

  // Prefer narrow, low-volume probes.
  for (const name of [
    "season",
    "year",
    "team",
    "conference",
    "seasonType",
    "startDateRange",
    "endDateRange",
    "startDate",
    "endDate",
    "date",
    "shootingPlaysOnly",
    "conferenceOnly",
    "limit",
    "page",
  ]) {
    if (!names.has(name)) continue;
    // Only use date scoping when season/year is not available.
    if (
      ["startDateRange", "endDateRange", "startDate", "endDate", "date"].includes(name) &&
      (names.has("season") || names.has("year"))
    ) {
      continue;
    }
    const value = knownParamValue(name, season);
    if (value !== undefined) query[name] = value;
  }

  // Fill supported required values that weren't included above.
  for (const p of queryParams) {
    if (!p.required || query[p.name] !== undefined) continue;
    const value = knownParamValue(p.name, season);
    if (value !== undefined) query[p.name] = value;
  }

  return { query, unsupportedRequired };
}

function isHistoricalCapable(params) {
  const names = new Set(params.filter((p) => p?.in === "query").map((p) => p.name));
  return [
    "season",
    "year",
    "startDateRange",
    "startDate",
    "date",
  ].some((name) => names.has(name));
}

async function fetchOpenApi(fetchFn = fetch) {
  const started = Date.now();
  try {
    const res = await fetchFn(`${CBBD_BASE}/api-docs.json`, {
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => null);
    return {
      ok: res.ok && Boolean(json?.paths),
      status: res.status,
      latencyMs: Date.now() - started,
      spec: json,
      reason: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      spec: null,
      reason: String(err?.message || err).slice(0, 240),
    };
  }
}

function safeYearRow(res, classification, query) {
  return {
    classification,
    httpStatus: res?.status ?? null,
    rowCount: Number(res?.n || 0),
    cacheHit: Boolean(res?.cacheHit),
    queryKeys: Object.keys(query || {}).sort(),
    sampleFieldNames: sampleFields(res?.data),
    reason: res?.reason ? String(res.reason).slice(0, 200) : null,
  };
}

export async function runCbbdEndpointAudit(env = {}, opts = {}) {
  const seasons = (opts.seasons || [2026, 2024, 2022])
    .map(Number)
    .filter(Number.isFinite);
  const maxRequests = Math.max(1, Math.min(100, Number(opts.maxRequests) || 18));
  const operationStart = Math.max(0, Number(opts.operationStart) || 0);
  const operationLimit = Math.max(1, Math.min(20, Number(opts.operationLimit) || 6));
  const fetchFn = opts.fetchFn || fetch;
  const configured = Boolean(collegeApiKey(env, "cbbd"));

  const schema = await fetchOpenApi(fetchFn);
  if (!schema.ok) {
    const result = redactSecrets({
      ok: false,
      configured,
      source: "cbbd",
      auditedAt: new Date().toISOString(),
      schema: {
        ok: false,
        httpStatus: schema.status,
        latencyMs: schema.latencyMs,
        reason: schema.reason,
      },
      summary: {
        requestCount: 0,
        requestCap: maxRequests,
        operationStart,
        operationLimit,
        inventoryGetOperations: 0,
        windowOperations: 0,
        hasMore: false,
        nextOperationStart: null,
      },
      inventory: [],
      probes: [],
    });
    assertNoSecretLeak(result, env);
    return result;
  }

  const spec = schema.spec;
  const inventory = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    const op = pathItem?.get;
    if (!op) continue;
    const params = paramsFor(spec, pathItem, op);
    inventory.push({
      path,
      operationId: op.operationId || null,
      summary: op.summary || null,
      tags: Array.isArray(op.tags) ? op.tags : [],
      pathParams: params
        .filter((p) => p?.in === "path")
        .map((p) => ({ name: p.name, required: Boolean(p.required) })),
      queryParams: params
        .filter((p) => p?.in === "query")
        .map((p) => ({ name: p.name, required: Boolean(p.required) })),
      historicalCapable: isHistoricalCapable(params),
    });
  }

  const probeInventory = inventory.slice(operationStart, operationStart + operationLimit);
  let requestCount = 0;
  const probes = [];

  for (const entry of probeInventory) {
    if (requestCount >= maxRequests) {
      probes.push({ ...entry, classification: CBBD_AUDIT_CLASS.NOT_PROBED, years: {}, sampleFieldNames: [] });
      continue;
    }

    if (entry.pathParams.length) {
      probes.push({
        ...entry,
        classification: CBBD_AUDIT_CLASS.SKIPPED_PATH_ID,
        years: {},
        sampleFieldNames: [],
      });
      continue;
    }

    const pathItem = spec.paths[entry.path];
    const params = paramsFor(spec, pathItem, pathItem.get);
    const yearsToTest = entry.historicalCapable ? seasons : seasons.slice(0, 1);
    const yearResults = {};
    const fieldSet = new Set();

    for (const season of yearsToTest) {
      if (requestCount >= maxRequests) break;
      const { query, unsupportedRequired } = buildQuery(params, season);
      if (unsupportedRequired.length) {
        yearResults[String(season)] = {
          classification: CBBD_AUDIT_CLASS.SKIPPED_REQUIRED_PARAM,
          httpStatus: null,
          rowCount: 0,
          queryKeys: Object.keys(query).sort(),
          unsupportedRequired,
          sampleFieldNames: [],
          reason: null,
        };
        continue;
      }

      requestCount += 1;
      const res = await cbbdGet(entry.path, env, {
        query,
        fetchFn,
        skipCache: true,
      });
      const classification = classify(res);
      const row = safeYearRow(res, classification, query);
      for (const field of row.sampleFieldNames) fieldSet.add(field);
      yearResults[String(season)] = row;
    }

    const tested = Object.values(yearResults);
    const best =
      tested.find((r) => r.classification === CBBD_AUDIT_CLASS.AVAILABLE) ||
      tested.find((r) => r.classification === CBBD_AUDIT_CLASS.AVAILABLE_BUT_EMPTY) ||
      tested.find((r) => !String(r.classification).startsWith("SKIPPED")) ||
      tested[0] ||
      null;

    probes.push({
      ...entry,
      classification: best?.classification || CBBD_AUDIT_CLASS.NOT_PROBED,
      years: yearResults,
      sampleFieldNames: [...fieldSet].slice(0, 70),
    });
  }

  const classifications = {};
  for (const p of probes) {
    classifications[p.classification] = (classifications[p.classification] || 0) + 1;
  }

  const historical = probes
    .filter((p) => p.historicalCapable)
    .map((p) => ({
      path: p.path,
      operationId: p.operationId,
      years: Object.fromEntries(
        Object.entries(p.years || {}).map(([year, row]) => [
          year,
          { classification: row.classification, rowCount: row.rowCount },
        ])
      ),
    }));

  const result = redactSecrets({
    ok: configured && schema.ok,
    configured,
    source: "cbbd",
    base: CBBD_BASE,
    auditedAt: new Date().toISOString(),
    seasonsTested: seasons,
    schema: {
      ok: true,
      httpStatus: schema.status,
      latencyMs: schema.latencyMs,
      title: spec.info?.title || null,
      version: spec.info?.version || null,
      getOperations: inventory.length,
    },
    summary: {
      requestCount,
      requestCap: maxRequests,
      operationStart,
      operationLimit,
      inventoryGetOperations: inventory.length,
      windowOperations: probeInventory.length,
      hasMore: operationStart + probeInventory.length < inventory.length,
      nextOperationStart:
        operationStart + probeInventory.length < inventory.length
          ? operationStart + probeInventory.length
          : null,
      probedOperations: probes.filter((p) => !String(p.classification).startsWith("SKIPPED") && p.classification !== CBBD_AUDIT_CLASS.NOT_PROBED).length,
      historicalCapableOperations: inventory.filter((p) => p.historicalCapable).length,
      classifications,
      available: probes.filter((p) => p.classification === CBBD_AUDIT_CLASS.AVAILABLE).map((p) => p.path),
      availableButEmpty: probes.filter((p) => p.classification === CBBD_AUDIT_CLASS.AVAILABLE_BUT_EMPTY).map((p) => p.path),
      notEntitled: probes.filter((p) => p.classification === CBBD_AUDIT_CLASS.NOT_ENTITLED).map((p) => p.path),
      invalidParameters: probes.filter((p) => p.classification === CBBD_AUDIT_CLASS.INVALID_PARAMETERS).map((p) => p.path),
      authFailure: probes.filter((p) => p.classification === CBBD_AUDIT_CLASS.AUTH_FAILURE).map((p) => p.path),
      transientFailure: probes.filter((p) => p.classification === CBBD_AUDIT_CLASS.TRANSIENT_FAILURE).map((p) => p.path),
      historical,
    },
    inventory,
    probes,
  });

  assertNoSecretLeak(result, env);
  return result;
}
