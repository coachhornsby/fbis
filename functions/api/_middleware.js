import { authorizeOperatorWrite, unauthorizedBody } from "../lib/auth.js";

/**
 * API write-surface guard.
 *
 * Read endpoints remain public. High-impact operator mutations on /api/track
 * require the strategy/harvest secret header. This prevents a public Pages
 * visitor from grading, reconstructing, or mutating the research ledger.
 */
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const method = String(request.method || "GET").toUpperCase();

  if (method === "POST" && url.pathname === "/api/track") {
    const auth = authorizeOperatorWrite(request, context.env);
    if (!auth.ok) {
      return new Response(JSON.stringify(unauthorizedBody(auth.reason || "unauthorized")), {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  }

  return context.next();
}
