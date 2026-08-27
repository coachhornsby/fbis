/**
 * Harvest / strategy-import secrets. Never log the value.
 * POST /api/strategy uses the header only (no query string, no arbitrary CORS).
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

/** Collect/harvest: header preferred, query accepted for compatibility. */
export function authorizeHarvest(request, env) {
  const expected = harvestSecret(env);
  if (!expected) return { ok: true, configured: false };
  const got = headerSecret(request) || querySecret(request);
  if (got !== expected) return { ok: false, configured: true };
  return { ok: true, configured: true };
}

/** Strategy POST: fail closed. Header only. */
export function authorizeStrategyPost(request, env) {
  const expected = strategySecret(env);
  if (!expected) return { ok: false, reason: "secret-unconfigured" };
  const got = headerSecret(request);
  if (got !== expected) return { ok: false, reason: "unauthorized" };
  return { ok: true };
}

export function unauthorizedBody() {
  return { ok: false, error: "unauthorized" };
}
