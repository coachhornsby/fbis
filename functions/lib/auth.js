/**
 * Harvest / strategy-import secrets. Never log the value.
 * POST /api/strategy uses the header only (no query string, no arbitrary CORS).
 * Heritage executed-bet import from the operator board is same-origin, not a pasted secret.
 */

export function harvestSecret(env) {
  return env?.HARVEST_SECRET || null;
}

export function strategySecret(env) {
  return env?.STRATEGY_IMPORT_SECRET || env?.HARVEST_SECRET || null;
}

function headerSecret(request) {
  if (!request?.headers?.get) return null;
  return request.headers.get("x-harvest-secret") || request.headers.get("x-strategy-secret") || null;
}

function querySecret(request) {
  try {
    return new URL(request.url).searchParams.get("secret");
  } catch {
    return null;
  }
}

function requestOrigin(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/** Browser fetch from the FBIS Pages origin — not a substitute for collect/strategy secrets. */
export function isSameOriginOperatorRequest(request) {
  const pageOrigin = requestOrigin(request);
  if (!pageOrigin) return false;
  const origin = String(request.headers?.get?.("origin") || "");
  if (origin && origin === pageOrigin) return true;
  const site = String(request.headers?.get?.("sec-fetch-site") || "").toLowerCase();
  if (site === "same-origin") return true;
  const referer = String(request.headers?.get?.("referer") || "");
  if (referer) {
    try {
      if (new URL(referer).origin === pageOrigin) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Collect/harvest: header preferred, query accepted for compatibility. */
export function authorizeHarvest(request, env) {
  const expected = harvestSecret(env);
  if (!expected) return { ok: true, configured: false };
  const got = headerSecret(request) || querySecret(request);
  if (got !== expected) return { ok: false, configured: true };
  return { ok: true };
}

/** Strategy POST: fail closed. Header only. */
export function authorizeStrategyPost(request, env) {
  const expected = strategySecret(env);
  if (!expected) return { ok: false, reason: "secret-unconfigured" };
  const got = headerSecret(request);
  if (got !== expected) return { ok: false, reason: "unauthorized" };
  return { ok: true };
}

/** Heritage import/correct: same-origin board, or the harvest header for scripts. */
export function authorizeExecutedBetWrite(request, env) {
  if (isSameOriginOperatorRequest(request)) return { ok: true, via: "same-origin" };
  return authorizeStrategyPost(request, env);
}

export function unauthorizedBody() {
  return { ok: false, error: "unauthorized", wrote: false };
}
