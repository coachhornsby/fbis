/**
 * CollegeFootballData / CollegeBasketballData credentials.
 * Never log, stringify, URL-encode, persist, or return the bearer value.
 * Football and basketball may share one Pages secret; CBBD_API_KEY is an alias.
 */

export const CFBD_KEY_NAME = "CFBD_API_KEY";
export const CBBD_KEY_NAME = "CBBD_API_KEY";
export const KENPOM_KEY_NAME = "KENPOM_API_KEY";

function trim(v) {
  return String(v || "").trim();
}

/** Resolve a bearer without duplicating the literal in source. */
export function collegeApiKey(env = {}, source = "cfbd") {
  const cfbd = trim(env.CFBD_API_KEY);
  const cbbd = trim(env.CBBD_API_KEY);
  if (source === "cbbd") return cbbd || cfbd;
  return cfbd || cbbd;
}

export function kenpomApiKey(env = {}) {
  return trim(env.KENPOM_API_KEY);
}

export function kenpomConfigured(env = {}) {
  return Boolean(kenpomApiKey(env));
}

export function cfbdConfigured(env = {}) {
  return Boolean(collegeApiKey(env, "cfbd"));
}

export function cbbdConfigured(env = {}) {
  return Boolean(collegeApiKey(env, "cbbd"));
}

export function collegeKeyHealth(env = {}) {
  return {
    cfbdConfigured: cfbdConfigured(env),
    cbbdConfigured: cbbdConfigured(env),
    sharedAlias: cfbdConfigured(env) && !trim(env.CBBD_API_KEY),
    kenpomConfigured: kenpomConfigured(env),
    cfbdKeyName: CFBD_KEY_NAME,
    cbbdKeyName: CBBD_KEY_NAME,
    kenpomKeyName: KENPOM_KEY_NAME,
  };
}

export function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/CFBD_API_KEY[=:]\s*\S+/gi, "CFBD_API_KEY=[redacted]")
      .replace(/CBBD_API_KEY[=:]\s*\S+/gi, "CBBD_API_KEY=[redacted]")
      .replace(/KENPOM_API_KEY[=:]\s*\S+/gi, "KENPOM_API_KEY=[redacted]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/key|token|secret|authorization|bearer/i.test(k)) out[k] = v ? "[redacted]" : v;
      else out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

export function assertNoSecretLeak(payload, env = {}) {
  const dump = typeof payload === "string" ? payload : JSON.stringify(payload);
  const keys = [trim(env.CFBD_API_KEY), trim(env.CBBD_API_KEY), trim(env.KENPOM_API_KEY)].filter(Boolean);
  for (const k of keys) {
    if (k && dump.includes(k)) throw new Error("college-api-secret-leak");
  }
  if (/Bearer\s+[A-Za-z0-9._\-]{8,}/.test(dump)) throw new Error("college-api-bearer-leak");
  return true;
}
