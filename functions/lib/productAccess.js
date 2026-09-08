/** Read-only product access boundary. Public data is open; PRO fails closed until configured. */
function header(request, name) { return request?.headers?.get?.(name) || null; }

function sameValue(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function authorizeProductTier(request, env = {}, tier = "public") {
  const normalized = String(tier || "public").toLowerCase();
  if (normalized === "public") return { ok: true, tier: "public", reason: null };
  if (normalized !== "pro") return { ok: false, tier: normalized, reason: "unsupported-tier" };
  const expected = env.SUBSCRIBER_API_TOKEN;
  if (!expected) return { ok: false, tier: "pro", reason: "pro-access-unconfigured" };
  const supplied = header(request, "x-fbis-pro-token");
  return sameValue(supplied, expected)
    ? { ok: true, tier: "pro", reason: null }
    : { ok: false, tier: "pro", reason: "pro-auth-required" };
}

/**
 * Product responses have different confidentiality requirements by tier.
 * PUBLIC can use shared caches. PRO contains subscriber-only analysis and must
 * never enter a shared cache, even when a CDN honors Vary correctly.
 */
export function productResponsePolicy(tier = "public") {
  const normalized = String(tier || "public").toLowerCase();
  if (normalized === "pro") {
    return {
      cacheControl: "private, no-store, max-age=0",
      allowOrigin: null,
      vary: "x-fbis-pro-token",
    };
  }
  return {
    cacheControl: "public, max-age=60, stale-while-revalidate=120",
    allowOrigin: "*",
    vary: "accept-encoding",
  };
}
