import { harvestSecret } from "../lib/auth.js";
import { verifyOperationsRouting, clearOperationsSchemaCache } from "../lib/operationsDb.js";
import { upsertOpsHealth, recordRunManifest } from "../lib/opsHealthLedger.js";

const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
});

export async function onRequestGet({ env, request } = {}) {
  const secret = harvestSecret(env);
  const provided = request?.headers?.get("x-harvest-secret");
  if (!secret || !provided || provided !== secret) {
    return response({ ok: false, error: "FORBIDDEN" }, 403);
  }

  try {
    const url = new URL(request.url);
    const probeWrite = url.searchParams.get("probeWrite") === "1";
    clearOperationsSchemaCache();
    let writeProbe = null;
    if (probeWrite) {
      const runId = `ops-routing-probe:${Date.now()}`;
      const componentId = "capacity-monitor";
      const at = new Date().toISOString();
      const health = await upsertOpsHealth(env, {
        componentId,
        workflowFreshnessAt: at,
        lastAttemptAt: at,
        lastSuccessAt: at,
        lastVerifiedAt: at,
        status: "HEALTHY",
        severity: "INFO",
        metadata: { probe: "operations-routing", runId },
        updatedAt: at,
      });
      const manifest = await recordRunManifest(env, {
        runId,
        componentId,
        triggerType: "http",
        startedAt: at,
        finishedAt: at,
        status: "success",
        receivedItems: 1,
        persistedItems: 1,
        rejectedItems: 0,
        metadata: { probe: "operations-routing" },
      });
      writeProbe = { health, manifest, runId, componentId };
    }

    const verification = await verifyOperationsRouting(env);
    return response({
      ok: true,
      ...verification,
      writeProbe,
      operatorNote:
        verification.routing === "OPERATIONS_DB_ACTIVE"
          ? "Operational records are landing on OPERATIONS_DB."
          : verification.routing === "OPERATIONS_DB_READY_AWAITING_WRITES"
            ? "OPERATIONS_DB schema is ready; awaiting live control-plane writes."
            : "Writers are falling back to primary until OPERATIONS_DB schema is applied.",
    });
  } catch (err) {
    return response({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost() {
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
