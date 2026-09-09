import { authorizeOperatorWrite, authorizeExecutedBetWrite, unauthorizedBody } from "../lib/auth.js";

/**
 * API write-surface guard.
 *
 * Read endpoints remain public.
 * - Board operator actions (manual-final) allow same-origin, like Heritage import.
 * - Destructive research mutations on /api/track still require the strategy/harvest secret.
 */
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const method = String(request.method || "GET").toUpperCase();

  if (method === "POST" && url.pathname === "/api/track") {
    let action = "";
    try {
      const cloned = request.clone();
      const body = await cloned.json();
      action = String(body?.action || "").toLowerCase();
    } catch {
      action = "";
    }
    const auth =
      action === "manual-final"
        ? authorizeExecutedBetWrite(request, context.env)
        : authorizeOperatorWrite(request, context.env);
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
