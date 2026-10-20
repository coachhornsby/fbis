import { harvestSecret } from "../lib/auth.js";
import { buildCapacityOpsDashboard } from "../lib/capacityOpsDashboard.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
});

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  // Public read of non-secret capacity telemetry is allowed with harvest secret
  // to avoid leaking operational topology to anonymous clients.
  const secret = harvestSecret(env);
  const provided = request.headers.get("x-harvest-secret");
  if (!secret || provided !== secret) {
    if (url.searchParams.get("public") === "1") {
      // Minimal public strip — sizes only, no secrets.
      const full = await buildCapacityOpsDashboard(env);
      return json({
        contract: full.contract,
        generatedAt: full.generatedAt,
        canAuthorizeWager: false,
        storage: {
          marketHistoryQ4: full.storage?.databases?.marketHistoryQ4 || null,
          primary: {
            percentUsed: full.storage?.databases?.primary?.percentUsed ?? null,
            alertLevel: full.storage?.databases?.primary?.alertLevel ?? null,
          },
          archiveBacklog: full.storage?.q4?.archive?.backlogEligible ?? null,
          archivedTotal: full.storage?.q4?.archive?.archivedTotal ?? null,
        },
        coreOk: full.reliability?.coreBoard?.ok === true,
      });
    }
    return json({ ok: false, error: "UNAUTHORIZED", canAuthorizeWager: false }, 403);
  }
  const dashboard = await buildCapacityOpsDashboard(env);
  return json({ ok: true, ...dashboard });
}
