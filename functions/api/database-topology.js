import { harvestSecret } from "../lib/auth.js";
import {
  topologyManifest,
  probeTopologyCapacity,
  resolveCoreDb,
  resolveSportDb,
  productSportDbHandle,
  isSportDbAuthoritative,
  resolveMarketHistoryWriteDb,
  listMarketHistoryReadDbs,
  marketHistoryRetentionDecision,
  hydrateCutoverApprovals,
  SPORT_DATABASES,
  MARKET_HISTORY_HOT_WINDOW_MS,
} from "../lib/databaseTopology.js";
import { buildVerifiedCapacityPlan } from "../lib/marketHistoryCapacity.js";
import { copyNhlPilotTables, verifyNhlSportDbParity, verifyNhlRecordLevelParity } from "../lib/nhlSportDb.js";
import { shadowCompareNhlSportDb } from "../lib/sportDbShadow.js";
import { archiveColdMarketHistoryObservations } from "../lib/marketHistoryArchive.js";
import {
  archiveAndVerifyColdMarketHistory,
  archiveLateArrivalsBehindCursor,
} from "../lib/marketHistoryVerifiedArchive.js";
import { rehearseMarketHistoryRetirement } from "../lib/marketHistoryRetentionRehearsal.js";
import { buildCapacityOpsDashboard } from "../lib/capacityOpsDashboard.js";
import {
  copySportWorkingTables,
  verifySportWorkingParity,
  reconcileSportProjections,
  backfillSportEvidenceEnvelopes,
  copySportPrefixTables,
  syncSportWorkingDelta,
  sportMigrationScope,
} from "../lib/sportWorkingCopy.js";
import {
  publishCrossSportBoardSummary,
  readCrossSportBoardSummary,
  requireFreshCoreBoardSummary,
} from "../lib/coreBoardSummaries.js";
import { loadCoreBoardOverview } from "../lib/coreBoardConsumer.js";
import { rehearseSportCutover } from "../lib/sportCutoverRehearsal.js";
import { evaluateRetentionRelease } from "../lib/retentionGate.js";
import {
  evaluateTopologyBindingGate,
  topologyBindingRestorePlan,
} from "../lib/topologyBindingGate.js";
import { canonicalEvidenceManifest } from "../lib/canonicalEvidenceContract.js";

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

async function probeBinding(db, databaseId) {
  if (!db?.prepare) return { bound: false, databaseId, reachable: false };
  try {
    await db.prepare("SELECT 1 AS ok").first();
    return { bound: true, databaseId, reachable: true };
  } catch (error) {
    return {
      bound: true,
      databaseId,
      reachable: false,
      error: String(error?.message || error).slice(0, 160),
    };
  }
}

export async function verifyDeploymentBindings(env) {
  const checks = {
    DB: await probeBinding(env?.DB, "b50c724c-903b-4241-8ce1-48d931e7a44c"),
    CORE_DB: await probeBinding(env?.CORE_DB, "a5b438fa-eb16-4f03-95d7-1fc58ac72f04"),
    MARKET_HISTORY_DB: await probeBinding(env?.MARKET_HISTORY_DB, "c32ccf06-c896-4d24-bb89-3e87a7412899"),
    MARKET_HISTORY_2026Q4_DB: await probeBinding(env?.MARKET_HISTORY_2026Q4_DB, "e8b0b65d-90a6-4842-8ee7-0f85d75afb4c"),
    OPERATIONS_DB: await probeBinding(env?.OPERATIONS_DB, "2371df3a-17bf-44d6-abf0-d275cf2f331e"),
    COLD_HISTORY_DB: await probeBinding(env?.COLD_HISTORY_DB, "6fad1baf-126f-4ab8-9b80-a7d71637d6d4"),
    ARCHIVE: { bound: Boolean(env?.ARCHIVE?.put && env?.ARCHIVE?.get), reachable: Boolean(env?.ARCHIVE?.put) },
  };
  for (const plan of Object.values(SPORT_DATABASES)) {
    checks[plan.binding] = await probeBinding(env?.[plan.binding], plan.databaseId);
  }

  const productAuthority = {};
  for (const plan of Object.values(SPORT_DATABASES)) {
    const product = productSportDbHandle(env, plan.sport);
    productAuthority[plan.sport] = {
      mode: product.mode,
      binding: product.binding,
      productIoUsesSportDb: product.productIoUsesSportDb,
      isAuthoritative: isSportDbAuthoritative(env, plan.sport),
    };
  }

  const gate = evaluateTopologyBindingGate(env, { surface: "pages", requireShadowModes: true });
  const required = gate.present.concat(gate.missing);
  const missing = gate.missing.filter((k) => !checks[k]?.bound);
  const unreachable = required.filter((k) => checks[k]?.bound && checks[k]?.reachable === false);
  const anySportAuthoritative = Object.values(productAuthority).some((s) => s.productIoUsesSportDb);

  return {
    ok: gate.ok && missing.length === 0 && unreachable.length === 0 && !anySportAuthoritative,
    missing: [...new Set([...gate.missing, ...missing])],
    unreachable,
    modeFailures: gate.modeFailures,
    checks,
    productAuthority,
    anySportAuthoritative,
    bindingGate: gate,
    restorePlan: topologyBindingRestorePlan(),
    note: "Bindings may be present while productIoUsesSportDb stays false under shadow mode. Cutover still blocked.",
    canAuthorizeWager: false,
  };
}

export async function onRequestGet({ env, request } = {}) {
  if (!authorize(request, env)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  const manifest = topologyManifest();
  const liveCapacity = await probeTopologyCapacity(env);
  const writeTarget = await resolveMarketHistoryWriteDb(env);
  const core = resolveCoreDb(env);
  const bindings = await verifyDeploymentBindings(env);
  const sports = {};
  for (const plan of manifest.sports) {
    const resolved = resolveSportDb(env, plan.sport);
    const product = productSportDbHandle(env, plan.sport);
    sports[plan.sport] = {
      binding: resolved.binding,
      preferred: resolved.preferred,
      mode: resolved.mode,
      reason: resolved.reason,
      planBinding: plan.binding,
      pilotStatus: plan.pilotStatus,
      databaseId: plan.databaseId,
      sportDbBound: Boolean(resolved.sportDb?.prepare || (resolved.preferred && resolved.binding === plan.binding)),
      productIoUsesSportDb: product.productIoUsesSportDb,
      productBinding: product.binding,
    };
  }
  return json({
    ok: true,
    ...manifest,
    liveCapacity,
    bindingVerification: bindings,
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
  if (operation === "verify-bindings") {
    return json(await verifyDeploymentBindings(env));
  }
  if (operation === "nhl-copy") {
    return json(await copyNhlPilotTables(env, { limitPerTable: Math.min(20000, Number(body.limitPerTable) || 5000) }));
  }
  if (operation === "nhl-parity") {
    return json(await verifyNhlSportDbParity(env));
  }
  if (operation === "nhl-record-parity") {
    return json(await verifyNhlRecordLevelParity(env, {
      sampleSize: Math.min(200, Number(body.sampleSize) || 40),
    }));
  }
  if (operation === "nhl-shadow-compare") {
    return json(await shadowCompareNhlSportDb(env));
  }
  if (operation === "sport-copy") {
    const sport = String(body.sport || "").toLowerCase();
    if (!["nfl", "cfb", "nhl"].includes(sport)) {
      return json({ ok: false, error: "SPORT_COPY_LIMITED_TO_NFL_CFB_NHL", canAuthorizeWager: false }, 400);
    }
    return json(await copySportWorkingTables(env, sport, {
      pageSize: Math.min(2000, Number(body.pageSize) || 1000),
      maxPages: Math.min(200, Number(body.maxPages) || 50),
      limitPerTable: body.limitPerTable != null
        ? Math.min(50000, Number(body.limitPerTable))
        : null,
      resume: body.resume !== false,
    }));
  }
  if (operation === "sport-prefix-copy") {
    const sport = String(body.sport || "").toLowerCase();
    if (!["nfl", "cfb", "nhl"].includes(sport)) {
      return json({ ok: false, error: "SPORT_PREFIX_COPY_LIMITED_TO_NFL_CFB_NHL", canAuthorizeWager: false }, 400);
    }
    return json(await copySportPrefixTables(env, sport, {
      pageSize: Math.min(500, Number(body.pageSize) || 200),
      maxPages: Math.min(100, Number(body.maxPages) || 25),
      resume: body.resume !== false,
      tables: Array.isArray(body.tables) ? body.tables : null,
    }));
  }
  if (operation === "sport-delta-sync") {
    const sport = String(body.sport || "").toLowerCase();
    if (!["nfl", "cfb", "nhl"].includes(sport)) {
      return json({ ok: false, error: "SPORT_DELTA_SYNC_LIMITED_TO_NFL_CFB_NHL", canAuthorizeWager: false }, 400);
    }
    return json(await syncSportWorkingDelta(env, sport, {
      rounds: Math.min(20, Number(body.rounds) || 5),
      pageSize: Math.min(2000, Number(body.pageSize) || 1000),
      maxPages: Math.min(200, Number(body.maxPages) || 50),
      includePrefix: body.includePrefix === true,
    }));
  }
  if (operation === "sport-migration-scope") {
    const sport = String(body.sport || "").toLowerCase();
    return json({ ...sportMigrationScope(sport), plan: SPORT_DATABASES[sport] || null });
  }
  if (operation === "sport-parity") {
    const sport = String(body.sport || "").toLowerCase();
    if (!["nfl", "cfb", "nhl"].includes(sport)) {
      return json({ ok: false, error: "SPORT_PARITY_LIMITED_TO_NFL_CFB_NHL", canAuthorizeWager: false }, 400);
    }
    return json(await verifySportWorkingParity(env, sport));
  }
  if (operation === "sport-projection-reconcile") {
    const sport = String(body.sport || "").toLowerCase();
    if (!["nfl", "cfb", "nhl"].includes(sport)) {
      return json({ ok: false, error: "SPORT_RECONCILE_LIMITED_TO_NFL_CFB_NHL", canAuthorizeWager: false }, 400);
    }
    return json(await reconcileSportProjections(env, sport, {
      sampleSize: Math.min(200, Number(body.sampleSize) || 40),
    }));
  }
  if (operation === "sport-evidence-backfill") {
    const sport = String(body.sport || "").toLowerCase();
    if (!["nfl", "cfb", "nhl"].includes(sport)) {
      return json({ ok: false, error: "EVIDENCE_BACKFILL_LIMITED_TO_NFL_CFB_NHL", canAuthorizeWager: false }, 400);
    }
    return json(await backfillSportEvidenceEnvelopes(env, sport, {
      pageSize: Math.min(500, Number(body.pageSize) || 200),
      maxPages: Math.min(500, Number(body.maxPages) || 100),
      resume: body.resume !== false,
    }));
  }
  if (operation === "hydrate-cutover-approvals") {
    return json(await hydrateCutoverApprovals(env, {
      sport: body.sport ? String(body.sport).toLowerCase() : null,
    }));
  }
  if (operation === "sport-cutover-rehearsal") {
    const sport = String(body.sport || "nhl").toLowerCase();
    if (!["nhl", "nfl", "cfb"].includes(sport)) {
      return json({ ok: false, error: "REHEARSAL_LIMITED_TO_NHL_NFL_CFB", canAuthorizeWager: false }, 400);
    }
    return json(await rehearseSportCutover(env, sport, {
      injectMissingBinding: body.injectMissingBinding === true,
      injectPartialSport: body.injectPartialSport === true,
      injectStaleCore: body.injectStaleCore === true,
    }));
  }
  if (operation === "core-board-summary-publish") {
    return json(await publishCrossSportBoardSummary(env));
  }
  if (operation === "core-board-summary-read") {
    return json(await readCrossSportBoardSummary(env, {
      requireFresh: body.requireFresh !== false,
      maxAgeMs: body.maxAgeMs != null ? Number(body.maxAgeMs) : undefined,
    }));
  }
  if (operation === "core-board-summary-require-fresh") {
    return json(await requireFreshCoreBoardSummary(env, {
      maxAgeMs: body.maxAgeMs != null ? Number(body.maxAgeMs) : undefined,
    }));
  }
  if (operation === "core-board-overview") {
    return json(await loadCoreBoardOverview(env, {
      maxAgeMs: body.maxAgeMs != null ? Number(body.maxAgeMs) : undefined,
    }));
  }
  if (operation === "topology-binding-gate") {
    return json({
      pages: evaluateTopologyBindingGate(env, { surface: "pages" }),
      restorePlan: topologyBindingRestorePlan(),
      canAuthorizeWager: false,
    });
  }
  if (operation === "canonical-evidence-contract") {
    return json({ ...canonicalEvidenceManifest(), canAuthorizeWager: false });
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
  if (operation === "market-history-archive-verify") {
    return json(await archiveAndVerifyColdMarketHistory(env, {
      // Catch-up capacity: up to 2000 × 80 ≈ 160k rows per invocation.
      limit: Math.min(2000, Number(body.limit) || 2000),
      maxRounds: Math.min(80, Number(body.maxRounds) || 40),
      partitionBinding: body.partitionBinding || "MARKET_HISTORY_2026Q4_DB",
      archiveWrites: body.archiveWrites === true,
      verifyReadback: body.verifyReadback === true,
      // R2 durable-copy eligibility (default 1h). D1 deletion still requires 24h + retention gate.
      eligibilityMs: body.eligibilityMs != null
        ? Number(body.eligibilityMs)
        : undefined,
      resume: body.resume !== false,
      resetCheckpoint: body.resetCheckpoint === true,
      now: body.now ? new Date(body.now) : new Date(),
    }));
  }
  if (operation === "market-history-archive-late-arrivals") {
    return json(await archiveLateArrivalsBehindCursor(env, {
      limit: Math.min(2000, Number(body.limit) || 500),
      partitionBinding: body.partitionBinding || "MARKET_HISTORY_2026Q4_DB",
      archiveWrites: body.archiveWrites === true,
      verifyReadback: body.verifyReadback === true,
      eligibilityMs: body.eligibilityMs != null ? Number(body.eligibilityMs) : undefined,
      now: body.now ? new Date(body.now) : new Date(),
    }));
  }
  if (operation === "market-history-retention-rehearsal") {
    return json(await rehearseMarketHistoryRetirement(env, {
      limit: Math.min(500, Number(body.limit) || 100),
      partitionBinding: body.partitionBinding || "MARKET_HISTORY_2026Q4_DB",
      requireDecisionProtection: body.requireDecisionProtection !== false,
      now: body.now ? new Date(body.now) : new Date(),
    }));
  }
  if (operation === "capacity-ops-dashboard") {
    return json({
      ok: true,
      ...(await buildCapacityOpsDashboard(env)),
    });
  }
  if (operation === "market-history-capacity-plan") {
    let liveBytes = null;
    if (env?.MARKET_HISTORY_2026Q4_DB?.prepare) {
      try {
        const probe = await env.MARKET_HISTORY_2026Q4_DB.prepare("SELECT 1 AS healthy").all();
        const n = Number(probe?.meta?.size_after);
        if (Number.isSafeInteger(n) && n > 0) liveBytes = n;
      } catch { /* keep baseline */ }
    }
    const plan = buildVerifiedCapacityPlan(liveBytes != null ? { usedBytes: liveBytes } : {});
    return json({
      ...plan,
      deployedHotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
      liveQ4Bytes: liveBytes,
      canAuthorizeWager: false,
    });
  }
  if (operation === "retention-gate-evaluate") {
    return json({
      ...evaluateRetentionRelease(body.proposal || {}),
      canAuthorizeWager: false,
    });
  }
  return json({ ok: false, error: "UNKNOWN_OPERATION" }, 400);
}
