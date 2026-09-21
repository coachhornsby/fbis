#!/usr/bin/env node
/**
 * Controlled CFBD + CBBD capability audit.
 *
 * Purpose:
 * - prove what the configured subscription can actually retrieve now
 * - sample historical depth without bulk-exporting provider data
 * - enumerate current CBBD GET operations from its live OpenAPI schema
 * - never print or persist bearer tokens
 *
 * Default historical sample years: 2026, 2024, 2022.
 * CBBD request cap defaults to 60 network probes.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { runCfbdEndpointAudit, auditArtifactPayload } from "../functions/lib/cfbdEndpointAudit.js";
import { unwrapCollegeResponse } from "../functions/lib/collegeApi.js";
import { assertNoSecretLeak, redactSecrets } from "../functions/lib/collegeSecrets.js";

const YEARS = (process.env.COLLEGE_AUDIT_YEARS || "2026,2024,2022")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter(Number.isFinite);
const CBBD_MAX_REQUESTS = Number(process.env.CBBD_AUDIT_MAX_REQUESTS || 60);
const CBBD_BASE = "https://api.collegebasketballdata.com";
const CBBD_SPEC = `${CBBD_BASE}/api-docs.json`;

function rowCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return 1;
  return 0;
}

function sampleFields(data) {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== "object") return [];
  const top = Object.keys(sample).sort().slice(0, 50);
  const nested = [];
  for (const [k, v] of Object.entries(sample)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const nk of Object.keys(v).sort().slice(0, 12)) nested.push(`${k}.${nk}`);
    }
  }
  return [...top, ...nested.slice(0, 30)];
}

function classify(status, ok, n, msg = "") {
  const s = Number(status) || 0;
  const m = String(msg || "").toLowerCase();
  if (s === 401 || /auth|token|api.?key/.test(m)) return "AUTH-FAILURE";
  if (s === 402 || s === 403 || /entitl|upgrade|subscription|plan|tier/.test(m)) return "NOT-ENTITLED";
  if (s === 404) return "DEPRECATED-OR-MISSING";
  if (s === 400 || s === 422) return "INVALID-PARAMETERS";
  if (s === 429 || s >= 500 || s === 0) return "TRANSIENT-FAILURE";
  if (ok && n === 0) return "AVAILABLE-BUT-EMPTY";
  if (ok) return "AVAILABLE";
  return "TRANSIENT-FAILURE";
}

async function fetchJson(url, { key = null } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    });
    let json = null;
    let text = "";
    try {
      json = await res.json();
    } catch {
      try { text = await res.text(); } catch {}
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: text.slice(0, 300),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err?.message || err).slice(0, 300),
      latencyMs: Date.now() - started,
    };
  }
}

function resolveRef(spec, value) {
  if (!value?.$ref) return value;
  const prefix = "#/components/parameters/";
  if (!String(value.$ref).startsWith(prefix)) return value;
  return spec?.components?.parameters?.[String(value.$ref).slice(prefix.length)] || value;
}

function opParams(spec, pathItem, op) {
  return [...(pathItem?.parameters || []), ...(op?.parameters || [])]
    .map((p) => resolveRef(spec, p))
    .filter(Boolean);
}

function seasonWindow(season) {
  return {
    start: `${season}-11-01T00:00:00Z`,
    end: `${season + 1}-04-15T23:59:59Z`,
    date: `${season + 1}-01-15`,
  };
}

function paramValue(name, season) {
  const n = String(name || "");
  const w = seasonWindow(season);
  const values = {
    season,
    year: season,
    team: "Duke",
    conference: "ACC",
    startDateRange: w.start,
    endDateRange: w.end,
    startDate: w.start,
    endDate: w.end,
    date: w.date,
    seasonType: "regular",
    shootingPlaysOnly: false,
    limit: 50,
    page: 1,
  };
  return Object.prototype.hasOwnProperty.call(values, n) ? values[n] : undefined;
}

function queryForOperation(params, season) {
  const query = {};
  const unsupportedRequired = [];
  const names = new Set(params.filter((p) => p?.in === "query").map((p) => p.name));

  for (const p of params) {
    if (p?.in !== "query") continue;
    const val = paramValue(p.name, season);
    if (p.required && val === undefined) unsupportedRequired.push(p.name);
  }

  // Always use narrow scoping when supported to reduce quota/response sizes.
  for (const key of ["season", "year", "team", "seasonType", "limit"]) {
    if (names.has(key)) {
      const val = paramValue(key, season);
      if (val !== undefined) query[key] = val;
    }
  }
  // If the endpoint has no season/year but supports a date range, use a narrow week.
  if (!names.has("season") && !names.has("year")) {
    const w = seasonWindow(season);
    if (names.has("startDateRange")) query.startDateRange = w.start;
    if (names.has("endDateRange")) query.endDateRange = `${season}-11-08T23:59:59Z`;
    if (names.has("date")) query.date = w.date;
  }
  // Add required supported params not already set.
  for (const p of params) {
    if (p?.in !== "query" || !p.required || query[p.name] !== undefined) continue;
    const val = paramValue(p.name, season);
    if (val !== undefined) query[p.name] = val;
  }
  return { query, unsupportedRequired };
}

function toQueryString(query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

async function auditCbbd(key) {
  const specRes = await fetchJson(CBBD_SPEC);
  if (!specRes.ok || !specRes.json?.paths) {
    return {
      ok: false,
      configured: Boolean(key),
      schema: { ok: false, status: specRes.status, error: specRes.text || "api-docs.json unavailable" },
      inventory: [],
      probes: [],
      summary: {},
    };
  }

  const spec = specRes.json;
  const inventory = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    const op = item?.get;
    if (!op) continue;
    const params = opParams(spec, item, op);
    inventory.push({
      path,
      operationId: op.operationId || null,
      summary: op.summary || null,
      tags: Array.isArray(op.tags) ? op.tags : [],
      pathParams: params.filter((p) => p?.in === "path").map((p) => ({ name: p.name, required: Boolean(p.required) })),
      queryParams: params.filter((p) => p?.in === "query").map((p) => ({ name: p.name, required: Boolean(p.required) })),
      acceptsSeason: params.some((p) => p?.in === "query" && ["season", "year"].includes(p.name)),
    });
  }

  const probes = [];
  let requestCount = 0;

  for (const entry of inventory) {
    if (requestCount >= CBBD_MAX_REQUESTS) break;

    // ID-specific paths are catalogued but not burned against quota in this first-pass audit.
    if (entry.pathParams.length) {
      probes.push({
        path: entry.path,
        operationId: entry.operationId,
        classification: "SKIPPED-REQUIRES-PATH-ID",
        years: {},
        sampleFieldNames: [],
      });
      continue;
    }

    const pathItem = spec.paths[entry.path];
    const params = opParams(spec, pathItem, pathItem.get);
    const yearsToTest = entry.acceptsSeason ? YEARS : [YEARS[0]];
    const yearResults = {};
    const allFields = new Set();

    for (const season of yearsToTest) {
      if (requestCount >= CBBD_MAX_REQUESTS) break;
      const { query, unsupportedRequired } = queryForOperation(params, season);
      if (unsupportedRequired.length) {
        yearResults[season] = {
          classification: "SKIPPED-UNSUPPORTED-REQUIRED-PARAM",
          unsupportedRequired,
          rowCount: 0,
          httpStatus: null,
        };
        continue;
      }

      requestCount += 1;
      const url = `${CBBD_BASE}${entry.path}${toQueryString(query)}`;
      const res = await fetchJson(url, { key });
      const unwrapped = unwrapCollegeResponse(res.json);
      const data = unwrapped.data;
      const n = rowCount(data);
      const error = !res.ok
        ? (unwrapped.error || res.text || `HTTP ${res.status}`)
        : (unwrapped.error || null);
      const classification = classify(res.status, res.ok && !unwrapped.error, n, error);
      const fields = sampleFields(data);
      fields.forEach((f) => allFields.add(f));

      yearResults[season] = {
        classification,
        httpStatus: res.status,
        rowCount: n,
        latencyMs: res.latencyMs,
        queryKeys: Object.keys(query).sort(),
        sampleFieldNames: fields,
        error: error ? String(error).slice(0, 220) : null,
      };
    }

    const tested = Object.values(yearResults);
    const best =
      tested.find((r) => r.classification === "AVAILABLE") ||
      tested.find((r) => r.classification === "AVAILABLE-BUT-EMPTY") ||
      tested[0] ||
      null;

    probes.push({
      path: entry.path,
      operationId: entry.operationId,
      summary: entry.summary,
      tags: entry.tags,
      acceptsSeason: entry.acceptsSeason,
      classification: best?.classification || "NOT-PROBED",
      years: yearResults,
      sampleFieldNames: [...allFields].slice(0, 70),
    });
  }

  const classes = {};
  for (const p of probes) classes[p.classification] = (classes[p.classification] || 0) + 1;

  const historical = probes
    .filter((p) => p.acceptsSeason)
    .map((p) => ({
      path: p.path,
      years: Object.fromEntries(
        Object.entries(p.years).map(([y, r]) => [y, { classification: r.classification, rowCount: r.rowCount }])
      ),
    }));

  return {
    ok: Boolean(key) && specRes.ok,
    configured: Boolean(key),
    schema: {
      ok: true,
      status: specRes.status,
      title: spec.info?.title || null,
      version: spec.info?.version || null,
      getOperations: inventory.length,
    },
    inventory,
    probes,
    summary: {
      requestCount,
      requestCap: CBBD_MAX_REQUESTS,
      inventoryGetOperations: inventory.length,
      probedOperations: probes.filter((p) => !String(p.classification).startsWith("SKIPPED")).length,
      historicalSeasonCapable: inventory.filter((p) => p.acceptsSeason).length,
      classifications: classes,
      available: probes.filter((p) => p.classification === "AVAILABLE").map((p) => p.path),
      availableButEmpty: probes.filter((p) => p.classification === "AVAILABLE-BUT-EMPTY").map((p) => p.path),
      notEntitled: probes.filter((p) => p.classification === "NOT-ENTITLED").map((p) => p.path),
      authFailure: probes.filter((p) => p.classification === "AUTH-FAILURE").map((p) => p.path),
      invalidParameters: probes.filter((p) => p.classification === "INVALID-PARAMETERS").map((p) => p.path),
      historical,
    },
  };
}

function mdTable(rows) {
  const safe = (v) => String(v ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    "| Source | Endpoint | 2026 | 2024 | 2022 | Sample fields |",
    "|---|---|---:|---:|---:|---|",
    ...rows.map((r) =>
      `| ${safe(r.source)} | \`${safe(r.endpoint)}\` | ${safe(r.y2026)} | ${safe(r.y2024)} | ${safe(r.y2022)} | ${safe(r.fields)} |`
    ),
  ].join("\n");
}

const cfbdKey = process.env.CFBD_API_KEY || process.env.CBBD_API_KEY || "";
const cbbdKey = process.env.CBBD_API_KEY || process.env.CFBD_API_KEY || "";

if (!cfbdKey && !cbbdKey) {
  console.error(JSON.stringify({ ok: false, error: "No college API key configured" }));
  process.exit(2);
}

const cfbd = await runCfbdEndpointAudit(
  { CFBD_API_KEY: cfbdKey, CBBD_API_KEY: cbbdKey },
  { seasons: YEARS, week: 8 }
);
const cbbd = await auditCbbd(cbbdKey);

const rows = [];
for (const [path, diag] of Object.entries(cfbd.byEndpoint || {})) {
  const endpoints = (cfbd.endpoints || []).filter((e) => e.endpoint === path);
  const byYear = Object.fromEntries(endpoints.map((e) => [String(e.seasonTested), e]));
  rows.push({
    source: "CFBD",
    endpoint: path,
    y2026: byYear["2026"]?.rowCount ?? "—",
    y2024: byYear["2024"]?.rowCount ?? "—",
    y2022: byYear["2022"]?.rowCount ?? "—",
    fields: (diag.sampleFieldNames || []).slice(0, 8).join(", "),
  });
}
for (const p of cbbd.probes || []) {
  rows.push({
    source: "CBBD",
    endpoint: p.path,
    y2026: p.years?.["2026"]?.rowCount ?? "—",
    y2024: p.years?.["2024"]?.rowCount ?? "—",
    y2022: p.years?.["2022"]?.rowCount ?? "—",
    fields: (p.sampleFieldNames || []).slice(0, 8).join(", "),
  });
}

const report = redactSecrets({
  ok: Boolean(cfbd?.ok) && Boolean(cbbd?.ok),
  auditedAt: new Date().toISOString(),
  yearsTested: YEARS,
  methodology: {
    kind: "controlled capability audit",
    cbbdRequestCap: CBBD_MAX_REQUESTS,
    note: "Counts/schema only; no bulk provider payload is persisted in the artifact.",
  },
  cfbd: auditArtifactPayload(cfbd),
  cbbd,
  comparisonRows: rows,
});

assertNoSecretLeak(report, {
  CFBD_API_KEY: cfbdKey,
  CBBD_API_KEY: cbbdKey,
});

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/college-capability-audit.json", JSON.stringify(report, null, 2));
writeFileSync("artifacts/college-capability-audit.md", [
  "# CFBD + CBBD controlled capability audit",
  "",
  `Audited: ${report.auditedAt}`,
  `Representative seasons: ${YEARS.join(", ")}`,
  "",
  "## Summary",
  "",
  `- CFBD: ${cfbd.summary?.resultCount || 0} probe results, ${cfbd.summary?.available?.length || 0} unique available endpoints.`,
  `- CBBD OpenAPI: ${cbbd.schema?.getOperations || 0} GET operations discovered.`,
  `- CBBD controlled requests: ${cbbd.summary?.requestCount || 0} / ${CBBD_MAX_REQUESTS} cap.`,
  `- CBBD available: ${cbbd.summary?.available?.length || 0}; available-but-empty: ${cbbd.summary?.availableButEmpty?.length || 0}; not-entitled: ${cbbd.summary?.notEntitled?.length || 0}.`,
  "",
  "## Representative historical row counts",
  "",
  mdTable(rows),
].join("\n"));

console.log(JSON.stringify({
  ok: report.ok,
  yearsTested: YEARS,
  cfbd: {
    configured: cfbd.summary?.configured,
    resultCount: cfbd.summary?.resultCount,
    uniqueEndpoints: cfbd.summary?.uniqueEndpoints,
    classifications: cfbd.summary?.classifications,
  },
  cbbd: {
    configured: cbbd.configured,
    schema: cbbd.schema,
    requestCount: cbbd.summary?.requestCount,
    classifications: cbbd.summary?.classifications,
    available: cbbd.summary?.available,
    availableButEmpty: cbbd.summary?.availableButEmpty,
    notEntitled: cbbd.summary?.notEntitled,
    authFailure: cbbd.summary?.authFailure,
  },
  artifact: "artifacts/college-capability-audit.json",
}, null, 2));
