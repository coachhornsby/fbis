import { harvestSecret } from "../lib/auth.js";
import { ownershipManifest, capacityAlertLevel, DATABASE_OWNERS } from "../lib/databaseOwnership.js";

const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
});

async function probeBytes(binding) {
  if (!binding?.prepare) return null;
  const result = await binding.prepare("SELECT 1 AS healthy").all();
  const bytes = Number(result?.meta?.size_after);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

export async function onRequestGet({ env, request } = {}) {
  const secret = harvestSecret(env);
  const provided = request?.headers?.get("x-harvest-secret");
  if (!secret || !provided || provided !== secret) {
    return response({ ok: false, error: "FORBIDDEN" }, 403);
  }

  const manifest = ownershipManifest();
  const live = {};
  try {
    const primaryBytes = await probeBytes(env?.DB);
    const historyBytes = await probeBytes(env?.MARKET_HISTORY_DB);
    const historyQ4Bytes = await probeBytes(env?.MARKET_HISTORY_2026Q4_DB);
    const operationsBytes = await probeBytes(env?.OPERATIONS_DB);
    const coreBytes = await probeBytes(env?.CORE_DB);
    const nhlBytes = await probeBytes(env?.NHL_DB);
    const coldBytes = await probeBytes(env?.COLD_HISTORY_DB);
    if (primaryBytes != null) live.PRIMARY = capacityAlertLevel(primaryBytes);
    if (historyBytes != null) live.MARKET_HISTORY = capacityAlertLevel(historyBytes);
    if (historyQ4Bytes != null) live.MARKET_HISTORY_2026Q4 = capacityAlertLevel(historyQ4Bytes);
    else live.MARKET_HISTORY_2026Q4 = { bound: Boolean(env?.MARKET_HISTORY_2026Q4_DB?.prepare), databaseId: DATABASE_OWNERS.MARKET_HISTORY_2026Q4?.databaseId };
    if (operationsBytes != null) live.OPERATIONS = capacityAlertLevel(operationsBytes);
    if (coreBytes != null) live.CORE = capacityAlertLevel(coreBytes);
    else live.CORE = { bound: Boolean(env?.CORE_DB?.prepare), databaseId: DATABASE_OWNERS.CORE?.databaseId };
    if (nhlBytes != null) live.NHL = capacityAlertLevel(nhlBytes);
    else live.NHL = { bound: Boolean(env?.NHL_DB?.prepare), databaseId: DATABASE_OWNERS.NHL?.databaseId };
    if (coldBytes != null) live.COLD_HISTORY = capacityAlertLevel(coldBytes);
    else {
      live.COLD_HISTORY = {
        bound: false,
        databaseId: DATABASE_OWNERS.COLD_HISTORY.databaseId,
        note: "Cold history measured by daily capacity monitor when Pages binding is absent.",
      };
    }
  } catch {
    return response({ ok: false, error: "OWNERSHIP_PROBE_FAILED" }, 503);
  }

  return response({
    ok: true,
    ...manifest,
    liveCapacity: live,
    operationsDbPreferred: Boolean(env?.OPERATIONS_DB?.prepare),
  });
}

export async function onRequestPost() {
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
