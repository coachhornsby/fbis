/**
 * CFBD / CBBD HTTP client. Server-side only.
 * Cache, batch, incremental. Quota ledger. Never logs the bearer.
 */

import { readCache, writeCache } from "./cache.js";
import { collegeApiKey, redactSecrets } from "./collegeSecrets.js";
import { QUOTA_COST, utcMonthKey } from "./quota.js";
import { recordApiUsage } from "./collegeStore.js";

export const CFBD_BASE = "https://api.collegefootballdata.com";
export const CBBD_BASE = "https://api.collegebasketballdata.com";
export const CFBD_TTL_MS = 6 * 60 * 60 * 1000;
export const CBBD_TTL_MS = 6 * 60 * 60 * 1000;
export const ERR_TTL_MS = 15 * 60 * 1000;

export function unwrapCollegeResponse(json) {
  if (json == null) return { data: null, meta: null };
  if (Array.isArray(json)) return { data: json, meta: null };
  if (Array.isArray(json.data?.items)) return { data: json.data.items, meta: json.meta || null };
  if (Array.isArray(json.data)) return { data: json.data, meta: json.meta || null };
  if (Array.isArray(json.items)) return { data: json.items, meta: json.meta || null };
  if (json && typeof json === "object" && (json.message || json.error) && !json.team && !json.year && !json.season) {
    return { data: null, meta: json.meta || null, error: json.message || json.error };
  }
  return { data: json, meta: json.meta || null };
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function cacheKey(source, path, query) {
  return `college:${source}:${path}:${JSON.stringify(query || {})}`;
}

export function collegePublicResult(res) {
  return redactSecrets({
    ok: Boolean(res?.ok),
    status: res?.status ?? 0,
    n: res?.n ?? 0,
    path: res?.path || null,
    source: res?.source || null,
    cacheHit: Boolean(res?.cacheHit),
    reason: res?.reason || null,
    records: res?.n ?? 0,
    usagePersisted: res?.usagePersisted == null ? null : Boolean(res.usagePersisted),
    usageError: res?.usageError || null,
  });
}

async function attachUsagePersistence(env, res, row) {
  const usage = await recordApiUsage(env, row);
  return {
    ...res,
    usagePersisted: Boolean(usage?.ok),
    usageError: usage?.ok ? null : usage?.reason || "api_usage-unavailable",
  };
}

/**
 * Authenticated GET. Key is used as Authorization Bearer only — never appended to the URL.
 */
export async function collegeRequest(source, path, env = {}, { query, fetchFn = fetch, ttlMs, skipCache = false } = {}) {
  const src = source === "cbbd" ? "cbbd" : "cfbd";
  const base = src === "cbbd" ? CBBD_BASE : CFBD_BASE;
  const key = collegeApiKey(env, src);
  const started = Date.now();
  if (!key) {
    const miss = { ok: false, status: 0, reason: "no-api-key", data: null, n: 0, path, source: src, cacheHit: false };
    return attachUsagePersistence(env, miss, usageRow(src, path, miss, started, query));
  }
  const ck = cacheKey(src, path, query);
  const ttl = ttlMs ?? (src === "cbbd" ? CBBD_TTL_MS : CFBD_TTL_MS);
  if (!skipCache) {
    const cached = await readCache(ck, env.caches, ttl);
    if (cached && cached.data !== undefined) {
      const hit = { ...cached, cacheHit: true, path, source: src };
      return attachUsagePersistence(env, hit, usageRow(src, path, hit, started, query, { cacheHit: true }));
    }
  }
  const url = `${base}${path}${queryString(query)}`;
  try {
    const res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const status = res.status;
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const unwrapped = unwrapCollegeResponse(json);
    const list = Array.isArray(unwrapped.data) ? unwrapped.data : unwrapped.data == null ? [] : null;
    const n = Array.isArray(list) ? list.length : unwrapped.data ? 1 : 0;
    if (!res.ok) {
      const fail = {
        ok: false,
        status,
        reason: `${src.toUpperCase()} ${status} ${path}`,
        data: null,
        n: 0,
        path,
        source: src,
        cacheHit: false,
      };
      await writeCache(ck, fail, env.caches, ERR_TTL_MS);
      return attachUsagePersistence(env, fail, usageRow(src, path, fail, started, query));
    }
    const ok = {
      ok: true,
      status,
      data: Array.isArray(list) ? list : unwrapped.data,
      n,
      path,
      source: src,
      cacheHit: false,
      meta: unwrapped.meta || null,
    };
    await writeCache(ck, ok, env.caches, ttl);
    return attachUsagePersistence(env, ok, usageRow(src, path, ok, started, query));
  } catch (err) {
    const fail = {
      ok: false,
      status: 0,
      reason: String(err?.message || err),
      data: null,
      n: 0,
      path,
      source: src,
      cacheHit: false,
    };
    return attachUsagePersistence(env, fail, usageRow(src, path, fail, started, query));
  }
}

function usageRow(source, path, res, started, query, extra = {}) {
  return {
    source,
    endpoint: path,
    month: utcMonthKey(),
    capturedAt: new Date().toISOString(),
    cacheHit: Boolean(extra.cacheHit || res.cacheHit),
    httpStatus: res.status ?? 0,
    recordsReturned: res.n ?? 0,
    quotaCost: extra.cacheHit || res.cacheHit ? QUOTA_COST.cacheHit : QUOTA_COST.default,
    ok: Boolean(res.ok),
    reason: res.reason || null,
    queryKeys: query ? Object.keys(query).sort().join(",") : "",
    elapsedMs: Date.now() - started,
  };
}

export async function cfbdGet(path, env, opts) {
  return collegeRequest("cfbd", path, env, opts);
}

export async function cbbdGet(path, env, opts) {
  return collegeRequest("cbbd", path, env, opts);
}

export function cfbSeasonYear(date = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date instanceof Date ? date : new Date(date));
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 8 ? y : y - 1;
}

export function cbbSeasonYear(date = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date instanceof Date ? date : new Date(date));
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 10 ? y : y - 1;
}

/** Harmless authenticated discovery: one cheap endpoint, field names only. */
export function summarizeSchema(rows) {
  const sample = Array.isArray(rows) ? rows[0] : rows;
  if (!sample || typeof sample !== "object") return { fields: [], n: Array.isArray(rows) ? rows.length : 0 };
  return {
    fields: Object.keys(sample).sort(),
    n: Array.isArray(rows) ? rows.length : 1,
    nested: Object.fromEntries(
      Object.entries(sample)
        .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
        .map(([k, v]) => [k, Object.keys(v).sort()])
    ),
  };
}
