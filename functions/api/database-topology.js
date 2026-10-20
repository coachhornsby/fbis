import { harvestSecret } from "../lib/auth.js";
import {
  topologyManifest,
  probeTopologyCapacity,
  resolveCoreDb,
  resolveSportDb,
  resolveMarketHistoryWriteDb,
  listMarketHistoryReadDbs,
  marketHistoryRetentionDecision,
} from "../lib/databaseTopology.js";
import { copyNhlPilotTables, verifyNhlSportDbParity } from "../lib/nhlSportDb.js";
import { shadowCompareNhlSportDb } from "../lib/sportDbShadow.js";
import { archiveColdMarketHistoryObservations } from "../lib/marketHistoryArchive.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
});

function authorize(request, env) {
  const secret = harvestSecret(env);
  const provided = request?.headers?.get("x-harvest-secret");
  return Boolean(secret && provided && provided === secret);
}

export async function onRequestGet({ env, request } = {}) {
  if (!authorize(request, env)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  const manifest = topologyManifest();
  const liveCapacity = await probeTopologyCapacity(env);
  const writeTarget = await resolveMarketHistoryWriteDb(env);
  const core = resolveCoreDb(env);
  const sports = {};
  for (const plan of manifest.sports) {
    const resolved = resolveSportDb(env, plan.sport);
    sports[plan.sport] = {
      binding: resolved.binding,
      preferred: resolved.preferred,
      mode: resolved.mode,
      reason: resolved.reason,
      planBinding: plan.binding,
      pilotStatus: plan.pilotStatus,
      databaseId: plan.databaseId,
      sportDbBound: Boolean(resolved.sportDb?.prepare || (resolved.preferred && resolved.binding === plan.binding)),
    };
  }
  return json({
    ok: true,
    ...manifest,
    liveCapacity,
    routing: {
      core: { binding: core.binding, preferred: core.preferred, warning: core.warning || null },
      sports,
      nhl: sports.nhl || null,
      marketHistoryWrite: {
        binding: writeTarget.binding,
        store: writeTarget.store,
        warning: writeTarget.warning || null,
        capacity: writeTarget.capacity || null,
      },
      marketHistoryReads: listMarketHistoryReadDbs(env).map((p) => p.binding),
      retentionSample: marketHistoryRetentionDecision({
        collectedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      }),
    },
    canAuthorizeWager: false,
  });
}

export async function onRequestPost({ env, request } = {}) {
  if (!authorize(request, env)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  let body = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const operation = String(body.operation || "");
  if (operation === "nhl-copy") {
    return json(await copyNhlPilotTables(env, { limitPerTable: Math.min(20000, Number(body.limitPerTable) || 5000) }));
  }
  if (operation === "nhl-parity") {
    return json(await verifyNhlSportDbParity(env));
  }
  if (operation === "nhl-shadow-compare") {
    return json(await shadowCompareNhlSportDb(env));
  }
  if (operation === "market-history-write-target") {
    const target = await resolveMarketHistoryWriteDb(env, { now: body.now || new Date() });
    return json({
      ok: Boolean(target.db),
      binding: target.binding,
      store: target.store,
      warning: target.warning || null,
      capacity: target.capacity || null,
      canAuthorizeWager: false,
    });
  }
  if (operation === "market-history-archive-scan") {
    return json(await archiveColdMarketHistoryObservations(env, {
      limit: Math.min(500, Number(body.limit) || 100),
      partitionBinding: body.partitionBinding || null,
      archiveWrites: body.archiveWrites === true,
      now: body.now ? new Date(body.now) : new Date(),
    }));
  }
  return json({ ok: false, error: "UNKNOWN_OPERATION" }, 400);
}
