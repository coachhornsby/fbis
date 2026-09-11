/**
 * Odds provider pool / router.
 *
 * Conceptual order (stop at first fresh+complete result):
 *   Parlay → TheOdds → SharpAPI → TheRundown → NO MARKET DATA
 *
 * Providers are intentional production redundancy. Absence of any one is a
 * safe degrade; absence of all valid market data is fail-closed.
 * Never fabricate or invent odds. Prefer conserving quota: do not query
 * backups when a preferred provider already returned fresh complete data.
 */

export const ODDS_PROVIDER_ORDER = Object.freeze([
  "parlay",
  "theodds",
  "sharpapi",
  "therundown",
]);

/**
 * @typedef {object} OddsProviderStatus
 * @property {string} provider
 * @property {boolean} configured
 * @property {boolean} healthy
 * @property {number|null} [quotaRemaining]
 * @property {string|null} [quotaResetAt]
 * @property {boolean} rateLimited
 * @property {string|null} [lastSuccessAt]
 * @property {string|null} [lastFailureAt]
 * @property {string|null} [lastError]
 * @property {boolean} [complete]
 * @property {string|null} [asOf]
 */

/**
 * @typedef {object} OddsProviderResult
 * @property {string} provider
 * @property {boolean} ok
 * @property {boolean} complete
 * @property {any[]} events
 * @property {string|null} [error]
 * @property {boolean} [rateLimited]
 * @property {boolean} [quotaExhausted]
 * @property {number|null} [quotaRemaining]
 * @property {string|null} [asOf]
 * @property {Record<string, any>} [meta]
 */

export function providerConfigured(credentials = {}) {
  return {
    parlay: Boolean(credentials.parlayApiKey),
    theodds: Boolean(credentials.theOddsApiKey),
    sharpapi: Boolean(credentials.sharpApiKey),
    therundown: Boolean(credentials.theRundownApiKey),
  };
}

/** @deprecated alias — prefer providerConfigured */
export const providersConfigured = providerConfigured;

export function isFreshComplete(result, { nowMs = Date.now(), maxAgeMs = 15 * 60 * 1000 } = {}) {
  if (!result || !result.ok || !result.complete) return false;
  if (!Array.isArray(result.events) || result.events.length === 0) return false;
  if (result.incomplete) return false;
  if (result.asOf) {
    const t = Date.parse(result.asOf);
    if (Number.isFinite(t) && nowMs - t > maxAgeMs) return false;
  }
  return true;
}

export function isProviderUnavailable(result) {
  if (!result) return true;
  if (result.rateLimited || result.quotaExhausted) return true;
  if (result.error && !result.ok) return true;
  return false;
}

/**
 * Walk the provider pool until fresh complete market data is found.
 * Invokes fetchers lazily — later providers are not called once a winner exists.
 *
 * @param {object} opts
 * @param {Record<string, boolean>} opts.configured
 * @param {Record<string, function(): Promise<OddsProviderResult>>} opts.fetchers
 * @param {string[]} [opts.order]
 * @param {number} [opts.nowMs]
 * @param {number} [opts.maxAgeMs]
 */
export async function resolveOddsProviders(opts = {}) {
  const order = opts.order || ODDS_PROVIDER_ORDER;
  const configured = opts.configured || {};
  const fetchers = opts.fetchers || {};
  const quotaReserve = opts.quotaReserve && typeof opts.quotaReserve === "object" ? opts.quotaReserve : {};
  const attempts = [];
  const statuses = [];

  for (const provider of order) {
    const isConfigured = Boolean(configured[provider]);
    if (!isConfigured) {
      statuses.push({
        provider,
        configured: false,
        healthy: false,
        quotaRemaining: null,
        quotaResetAt: null,
        rateLimited: false,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: "not-configured",
        complete: false,
        asOf: null,
      });
      attempts.push({ provider, skipped: true, reason: "not-configured" });
      continue;
    }

    const fetch = fetchers[provider];
    if (typeof fetch !== "function") {
      statuses.push({
        provider,
        configured: true,
        healthy: false,
        quotaRemaining: null,
        quotaResetAt: null,
        rateLimited: false,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: "fetcher-missing",
        complete: false,
        asOf: null,
      });
      attempts.push({ provider, skipped: true, reason: "fetcher-missing" });
      continue;
    }

    const result = await fetch();
    const reserve = quotaReserve[provider];
    const quotaRemaining = result?.quotaRemaining ?? null;
    const nearReserve =
      Number.isFinite(reserve) &&
      Number.isFinite(quotaRemaining) &&
      quotaRemaining <= Number(reserve);
    const fresh = isFreshComplete(result, { nowMs: opts.nowMs, maxAgeMs: opts.maxAgeMs }) && !nearReserve;
    const failed = !fresh;
    statuses.push({
      provider,
      configured: true,
      healthy: Boolean(result?.ok) && !isProviderUnavailable(result) && !nearReserve,
      quotaRemaining,
      quotaResetAt: result?.quotaResetAt ?? null,
      rateLimited: Boolean(result?.rateLimited),
      lastSuccessAt: fresh ? result.asOf || new Date(opts.nowMs || Date.now()).toISOString() : null,
      lastFailureAt: failed ? new Date(opts.nowMs || Date.now()).toISOString() : null,
      lastError: nearReserve
        ? "quota-reserve"
        : result?.incomplete
          ? "market-incomplete"
          : result?.error || null,
      complete: Boolean(result?.complete && result?.events?.length && !result?.incomplete),
      asOf: result?.asOf || null,
    });
    attempts.push({
      provider,
      skipped: false,
      ok: Boolean(result?.ok),
      complete: Boolean(result?.complete),
      fresh,
      nearReserve,
      incomplete: Boolean(result?.incomplete),
      error: nearReserve ? "quota-reserve" : result?.error || null,
      eventCount: Array.isArray(result?.events) ? result.events.length : 0,
      asOf: result?.asOf || null,
      source: provider,
    });

    if (fresh) {
      return {
        ok: true,
        failClosed: false,
        provider,
        events: result.events,
        asOf: result.asOf || null,
        source: provider,
        meta: result.meta || {},
        attempts,
        statuses,
      };
    }
  }

  return {
    ok: false,
    failClosed: true,
    provider: null,
    events: [],
    asOf: null,
    source: null,
    reason: "no-valid-market-data",
    code: "NO_MARKET_DATA",
    meta: {},
    attempts,
    statuses,
  };
}

/**
 * Decide whether a Pages secret sync should write.
 * Empty / missing GitHub secrets must NEVER overwrite Cloudflare secrets.
 */
export function shouldSyncPagesSecret(value) {
  if (value == null) return { write: false, reason: "null" };
  const s = String(value);
  if (!s.trim()) return { write: false, reason: "empty" };
  return { write: true, reason: "present" };
}

export function planOddsSecretSync(secrets = {}) {
  const names = ["SHARPAPI_API_KEY", "THERUNDOWN_API_KEY", "THEODDS_API_KEY"];
  const plan = [];
  for (const name of names) {
    const decision = shouldSyncPagesSecret(secrets[name]);
    plan.push({ name, write: decision.write, reason: decision.reason });
  }
  return {
    plan,
    writes: plan.filter((p) => p.write).map((p) => p.name),
    skips: plan.filter((p) => !p.write).map((p) => p.name),
  };
}

/**
 * Qualification gate: never invent market data.
 */
export function canQualifyFromOddsResolution(resolution) {
  if (!resolution || resolution.failClosed || !resolution.ok) return false;
  if (!resolution.provider || !Array.isArray(resolution.events) || resolution.events.length === 0) {
    return false;
  }
  return true;
}
