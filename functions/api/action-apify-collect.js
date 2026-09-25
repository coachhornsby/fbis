import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  return json({
    ok: true,
    executed: false,
    status: "action_paused",
    reason: "ACTION/Apify collection is administratively paused.",
    plan: {
      input: {
        maxItems: String(context?.env?.ACTION_APIFY_PLAN || "").toLowerCase() === "starter" ? 200 : 10,
      },
    },
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
    affectsProductionOdds: false,
  });
}

export async function onRequestPost(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  return json({
    ok: true,
    executed: false,
    status: "action_paused",
    reason: "ACTION/Apify collection is administratively paused.",
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
    affectsProductionOdds: false,
  });
}
