import { readPolymarketUsAccount } from "../lib/polymarketUsAccount.js";

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
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    subtle.digest("SHA-256", encoder.encode(expected)),
    subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < aa.length; i++) mismatch |= aa[i] ^ bb[i];
  return mismatch === 0;
}

export async function onRequestGet({ request, env }) {
  if (!env?.FBIS_ACCOUNT_VIEW_TOKEN) return reply({ ok: false, code: "PORTFOLIO_ACCESS_NOT_CONFIGURED" }, 503);
  const supplied = request.headers.get("x-fbis-account-token");
  if (!await sameToken(env.FBIS_ACCOUNT_VIEW_TOKEN, supplied)) {
    return reply({ ok: false, code: "PORTFOLIO_ACCESS_DENIED" }, 403);
  }
  try {
    const result = await readPolymarketUsAccount(env);
    return reply(result, result.ok ? 200 : 503);
  } catch {
    return reply({ ok: false, code: "POLYMARKET_READ_UNAVAILABLE" }, 503);
  }
}
export async function onRequestPost() { return reply({ ok: false, code: "READ_ONLY" }, 405); }
