import { readKalshiAccount } from "../lib/kalshiAccount.js";
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store, max-age=0",
    "pragma": "no-cache",
    "x-robots-tag": "noindex, nofollow",
    "x-content-type-options": "nosniff",
  },
});
async function sameToken(expected, supplied, subtle = crypto.subtle) {
  if (!expected || !supplied || supplied.length > 512) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    subtle.digest("SHA-256", enc.encode(expected)),
    subtle.digest("SHA-256", enc.encode(supplied)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
/**
 * Dedicated operator-only portfolio route, not available to anonymous visitors.
 * Distinct view secret; never accept Kalshi signing keys from browsers.
 */
export async function onRequestGet({ request, env }) {
  if (!env?.FBIS_ACCOUNT_VIEW_TOKEN) return reply({ ok: false, code: "PORTFOLIO_ACCESS_NOT_CONFIGURED" }, 503);
  const token = request.headers.get("x-fbis-account-token");
  if (!await sameToken(env.FBIS_ACCOUNT_VIEW_TOKEN, token)) return reply({ ok: false, code: "PORTFOLIO_ACCESS_DENIED" }, 403);
  try {
    const data = await readKalshiAccount(env);
    return reply(data, data.ok ? 200 : 503);
  } catch {
    // Do not disclose private provider response, key, full error, or account PII.
    return reply({ ok: false, code: "PORTFOLIO_READ_UNAVAILABLE" }, 503);
  }
}
export async function onRequestPost() { return reply({ ok: false, code: "READ_ONLY" }, 405); }
