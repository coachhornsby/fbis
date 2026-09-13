import { durableHealth, deploymentCommit, scheduledHealth } from "../lib/jobs.js";
import { MODEL_VERSION } from "../lib/weights.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";
import { openHarvestRetries, queryExecutedBets, queryStrategyTickets, readMeta } from "../lib/store.js";
import { STRATEGY_HC_V1 } from "../lib/strategy.js";
import { classifyOpenHarvestRetries, deriveOddsBoardHealth, providerConfigFlags } from "../lib/marketLineage.js";
import { actionApifyCandidateHealth } from "../lib/actionApifyCollector.js";
import { loadDurableCandidateHealth } from "../lib/actionApifyEvidence.js";
import { decorateActionMarketHealth } from "../lib/actionMarketIntelligence.js";
import { buildOpsTelemetry } from "../lib/opsTelemetry.js";
// Action/Apify is live market intelligence, shadow-governed — never drives global DOWN.

const MIGRATION_STATUS = {
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  UNVERIFIED: "UNVERIFIED",
};

/** Production tip expects harden migration after public/Actions billing recovery. */
const EXPECTED_MIGRATION = "0025_manual_completion_contracts";

/**
 * Read-only health endpoint.
 * - No upstream API calls
 * - No projection writes
 * - No freeze/harvest side effects
 */
export async function onRequestGet(context) {
  const env = {
    DB: context.env.DB,
    CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
    CF_PAGES_COMMIT: context.env.CF_PAGES_COMMIT,
    CF_PAGES_BRANCH: context.env.CF_PAGES_BRANCH,
    CF_PAGES_URL: context.env.CF_PAGES_URL,
    CF_PAGES_DEPLOYMENT_ID: context.env.CF_PAGES_DEPLOYMENT_ID,
    BUILD_TIMESTAMP: context.env.BUILD_TIMESTAMP,
    GITHUB_SHA: context.env.GITHUB_SHA,
    COMMIT_SHA: context.env.COMMIT_SHA,
    // Boolean presence only — values never leave this scope / response.
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    // Presence only for Action candidate health — token value never returned.
    APIFY_TOKEN: context.env.APIFY_TOKEN,
    ACTION_APIFY_ENABLED: context.env.ACTION_APIFY_ENABLED,
    ACTION_APIFY_PLAN: context.env.ACTION_APIFY_PLAN,
  };
  try {
    const health = await durableHealth(env);
    const schedule = scheduledHealth(health, new Date());
    const readOk = Boolean(health.bound) && String(health.source || "") === "d1";
    const writeVerification = writeVerificationState({
      readOk,
      lastWriteSuccessAt: health.lastD1WriteSuccessAt || null,
      lastReadbackSuccessAt: health.lastD1ReadbackSuccessAt || health.lastD1WriteSuccessAt || null,
      lastFailureAt: health.lastD1FailureAt || health.lastFailedCollectAt || health.lastFailedHarvestAt || null,
      failedWrites: Number(health.failedWrites || 0) + Number(health.failedHarvests || 0),
      reason: health.lastError || health.source || "",
    });
    const writeOk = writeVerification === "VERIFIED";
    const collectHealthy = schedule?.collect?.state === "healthy";
    const harvestHealthy = schedule?.harvest?.state === "healthy";
    const schema = await schemaVersion(env, { readOk });
    const conflicts = await conflictBreakdown(env, { readOk });
    const migrationOk = schema.status === MIGRATION_STATUS.VERIFIED;
    const derived = deriveHealthState({
      hasAuthoritativeData: readOk,
      requiredChecks: [
        { name: "d1-binding", ok: Boolean(health.bound), detail: health.bound ? "bound" : "unbound" },
        { name: "d1-read", ok: readOk, detail: health.source || "unknown" },
        { name: "d1-write", ok: writeOk, detail: `failedWrites=${Number(health.failedWrites || 0)} failedHarvests=${Number(health.failedHarvests || 0)}` },
        {
          name: "schema-migration",
          ok: migrationOk,
          detail: `${schema.status}:${schema.version || "none"} expected=${EXPECTED_MIGRATION}`,
        },
        {
          name: "scheduled-collect",
          ok: collectHealthy,
          detail: schedule?.collect?.state || "unknown",
          lastSuccessAt: health.lastScheduledCollectSuccessAt || null,
          // Max production gap is 02:00 → 13:00 UTC (~11h).
          freshnessMs: 12 * 60 * 60 * 1000,
        },
        {
          name: "scheduled-harvest",
          ok: harvestHealthy,
          detail: schedule?.harvest?.state || "unknown",
          lastSuccessAt: health.lastScheduledHarvestSuccessAt || null,
          // Max production gap is 16:20 → next 11:20 UTC (~19h).
          freshnessMs: 20 * 60 * 60 * 1000,
        },
      ],
    });
    const settleTargets = await listSettleTargets(env, { readOk });
    const providerConfigured = providerConfigFlags(env);
    let retryClassification = {
      total: Number(health.retryOpen || 0),
      counts: {},
      retryable: null,
      terminal: null,
      postKickoff: null,
      rows: [],
    };
    if (readOk && Number(health.retryOpen || 0) > 0) {
      try {
        const openRows = await openHarvestRetries(env, "all");
        retryClassification = classifyOpenHarvestRetries(openRows);
      } catch {
        /* classification is best-effort; never fail health */
      }
    }
    let oddsBoard = {
      boardAvailable: false,
      liveCollectionHealthy: false,
      boardSourceMode: null,
      bySport: {},
    };
    if (readOk) {
      try {
        const metaMap = await readMeta(env);
        oddsBoard = deriveOddsBoardHealth(metaMap);
      } catch {
        /* board health is best-effort */
      }
    }
    const operatorNotes = [];
    if (oddsBoard.boardAvailable && !oddsBoard.liveCollectionHealthy) {
      operatorNotes.push(
        "Board available from cache/fallback snapshot but live odds collection is unhealthy — cached boards must not be treated as live provider health."
      );
    }

    if (!harvestHealthy || derived.checks.some((c) => c.name === "scheduled-harvest" && !c.ok)) {
      operatorNotes.push("No successful harvest within the expected window.");
      operatorNotes.push(
        "Schedule diagnosis: harvest cron slots may not have fired; check Actions runs around 11:20/16:20 UTC before changing cadence. Watchdog catch-up should recover without editing crons."
      );
    }
    if (Number(health.retryOpen || 0) > 0) {
      operatorNotes.push(
        `${Number(health.retryOpen)} open harvest retries need classification or catch-up` +
          (retryClassification.retryable != null
            ? ` (retryable=${retryClassification.retryable}, terminal=${retryClassification.terminal}, postKickoff=${retryClassification.postKickoff}).`
            : ".")
      );
    }
    if (!providerConfigured.theodds || !providerConfigured.sharpapi || !providerConfigured.therundown) {
      const missing = Object.entries(providerConfigured)
        .filter(([k, v]) => k !== "parlay" && !v)
        .map(([k]) => k);
      if (missing.length) {
        operatorNotes.push(
          `OWNER ACTION REQUIRED: missing rotated odds backup credential(s): ${missing.join(", ")}. Do not restore compromised historical keys.`
        );
      }
    }
    const build = buildMeta(context.request, env, schema);
    return json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        deploymentCommit: deploymentCommit(env),
        modelVersion: MODEL_VERSION,
        build,
        state: derived.state,
        d1: {
          bound: Boolean(health.bound),
          source: health.source || (health.bound ? "d1" : "unbound"),
          lastD1WriteSuccessAt: health.lastD1WriteSuccessAt || null,
          lastD1ReadbackSuccessAt: health.lastD1ReadbackSuccessAt || null,
          lastD1FailureAt: health.lastD1FailureAt || null,
          readOk,
          writeOk,
          writeVerification,
        },
        oddsProviders: {
          order: ["parlay", "theodds", "sharpapi", "therundown"],
          configured: providerConfigured,
          boardAvailable: oddsBoard.boardAvailable,
          liveCollectionHealthy: oddsBoard.liveCollectionHealthy,
          boardSourceMode: oddsBoard.boardSourceMode,
          bySport: oddsBoard.bySport,
          note: "Boolean configured flags only. No secret values. Quota/rate-limit require live provider probes. boardAvailable can be true from cache while liveCollectionHealthy is false.",
        },
        actionApify: await (async () => {
          const ephemeral = actionApifyCandidateHealth(env);
          try {
            if (!env.DB) return decorateActionMarketHealth(ephemeral);
            const db = {
              queryOne: async (sql, params = []) => {
                const row = await env.DB.prepare(sql).bind(...params).first();
                return row || null;
              },
              queryAll: async (sql, params = []) => {
                const res = await env.DB.prepare(sql).bind(...params).all();
                return res?.results || [];
              },
            };
            const durable = await loadDurableCandidateHealth(env, db, {
              sport: "cfb",
              profile: "BASE",
              lifecycle: "pregame",
            });
            return decorateActionMarketHealth({ ...ephemeral, ...durable });
          } catch {
            return decorateActionMarketHealth(ephemeral);
          }
        })(),
        pipeline: {
          lastCollectSuccessAt: health.lastCollectSuccessAt || null,
          lastCollectAttemptAt: health.lastCollectAttemptAt || null,
          lastHarvestSuccessAt: health.lastHarvestSuccessAt || null,
          lastHarvestAttemptAt: health.lastHarvestAttemptAt || null,
          lastFailedCollectAt: health.lastFailedCollectAt || null,
          lastFailedHarvestAt: health.lastFailedHarvestAt || null,
          failedWrites: Number(health.failedWrites || 0),
          failedHarvests: Number(health.failedHarvests || 0),
          retryOpen: Number(health.retryOpen || 0),
          retryClassification: {
            total: retryClassification.total,
            counts: retryClassification.counts,
            retryable: retryClassification.retryable,
            terminal: retryClassification.terminal,
            postKickoff: retryClassification.postKickoff,
            // Cap rows to keep health payload bounded.
            sample: (retryClassification.rows || []).slice(0, 40),
          },
          immutableConflicts: Number(health.immutableConflicts || 0),
          conflictBreakdown: conflicts,
          schedule,
          settleTargets,
        },
        ops: await buildOpsTelemetry(env, {
          lastCollectSuccessAt: health.lastCollectSuccessAt || null,
          lastScheduledCollectSuccessAt: health.lastScheduledCollectSuccessAt || null,
          lastHarvestSuccessAt: health.lastHarvestSuccessAt || null,
          lastScheduledHarvestSuccessAt: health.lastScheduledHarvestSuccessAt || null,
        }).catch(() => null),
        checks: derived.checks,
        failures: derived.failures,
        staleChecks: derived.staleChecks,
        operatorNotes,
        lastJob: health.lastJob || null,
        telemetry: {
          endpoint: "/api/health",
          requestCount: 1,
          queryCountEstimate: readOk ? 8 : 2,
          rowsReadEstimate: 1,
          cacheStatus: "max-age=15",
          lastQuotaFailure: readOk ? null : (health.lastError || health.source || null),
        },
      },
      200,
      15
    );
  } catch (err) {
    return json(
      {
        ok: false,
        error: String(err?.message || err),
        generatedAt: new Date().toISOString(),
        deploymentCommit: deploymentCommit(env),
      },
      500,
      5
    );
  }
}

function json(data, status = 200, maxAge = 15) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });
}

function buildMeta(request, env, schema) {
  const host = new URL(request.url).hostname;
  const first = host.split(".")[0] || "";
  const deploymentIdFromHost = /^[a-f0-9]{8,}$/i.test(first) ? first : null;
  const branch = env.CF_PAGES_BRANCH || null;
  const environment = branch === "main" || host === "fbis-myz.pages.dev" ? "production" : "preview";
  return {
    commitSha: deploymentCommit(env),
    deploymentId: env.CF_PAGES_DEPLOYMENT_ID || deploymentIdFromHost || null,
    buildTimestamp: env.BUILD_TIMESTAMP || null,
    environment,
    branch,
    pagesUrl: env.CF_PAGES_URL || null,
    schemaVersion: schema.version,
    migrationStatus: schema.status,
    expectedMigration: EXPECTED_MIGRATION,
  };
}

async function schemaVersion(env, { readOk }) {
  if (!readOk || !env?.DB?.prepare) return { version: null, status: MIGRATION_STATUS.UNVERIFIED };
  try {
    const row = await env.DB.prepare("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1").first();
    const check = await env.DB.prepare("SELECT id FROM schema_migrations WHERE id = ? LIMIT 1")
      .bind(EXPECTED_MIGRATION)
      .first();
    return {
      version: row?.id || null,
      status: check?.id ? MIGRATION_STATUS.VERIFIED : MIGRATION_STATUS.UNVERIFIED,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/not authorized|authentication|permission/i.test(msg)) {
      return { version: null, status: MIGRATION_STATUS.BLOCKED };
    }
    if (/no such table|no such column|syntax/i.test(msg)) {
      return { version: null, status: MIGRATION_STATUS.FAILED };
    }
    return {
      version: null,
      status: MIGRATION_STATUS.UNVERIFIED,
    };
  }
}

/** Split write_conflicts into expected re-freeze duplicates vs genuine payload mismatches. */
async function conflictBreakdown(env, { readOk }) {
  const empty = {
    total: 0,
    expectedDuplicates: 0,
    genuineMismatches: 0,
    other: 0,
  };
  if (!readOk || !env?.DB?.prepare) return empty;
  try {
    const rows = await env.DB.prepare(
      "SELECT reason, COUNT(*) AS n FROM write_conflicts GROUP BY reason"
    ).all();
    const byReason = {};
    for (const row of rows?.results || []) {
      byReason[String(row.reason || "unknown")] = Number(row.n) || 0;
    }
    const genuineMismatches = Number(byReason["immutable-projection-mismatch"] || 0);
    const expectedDuplicates = Number(byReason["expected-duplicate"] || byReason["duplicate-insert"] || 0);
    const total = Object.values(byReason).reduce((s, n) => s + Number(n || 0), 0);
    return {
      total,
      expectedDuplicates,
      genuineMismatches,
      other: Math.max(0, total - expectedDuplicates - genuineMismatches),
      byReason,
    };
  } catch {
    return empty;
  }
}

/** Active (sport, date) pairs that still need settle/research catch-up. */
async function listSettleTargets(env, { readOk }) {
  if (!readOk) return [];
  const keyOf = (sport, date) => `${String(sport || "").toLowerCase()}|${String(date || "").slice(0, 10)}`;
  const out = new Map();
  try {
    const bets = await queryExecutedBets(env, { includeRaw: false });
    for (const b of bets.rows || []) {
      if (b.result && b.result !== "OPEN") continue;
      const sport = String(b.sport || "").toLowerCase();
      const date = String(b.date || "").slice(0, 10);
      if (!sport || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      // College tickets mislabeled mlb still settle via sport-correction when CFB finals are fetched.
      const key = keyOf(sport, date);
      const row = out.get(key) || { sport, date, openExecutedBets: 0, openStrategyTickets: 0 };
      row.openExecutedBets += 1;
      out.set(key, row);
      if (sport === "mlb") {
        // Also queue CFB for the same date when unmatched college-looking tickets exist.
        const text = `${b.matchupText || ""} ${b.awayTeam || ""} ${b.homeTeam || ""}`.toUpperCase();
        const looksCollege = /\b(STATE|UNIVERSITY|WAKE|AKRON|MARSHALL|PENN|FIU|USF|FLORIDA INTERNATIONAL|CENTRAL MICHIGAN|NEW MEXICO)\b/.test(text);
        if (looksCollege || b.matchStatus === "unmatched") {
          const cfbKey = keyOf("cfb", date);
          const cfb = out.get(cfbKey) || { sport: "cfb", date, openExecutedBets: 0, openStrategyTickets: 0 };
          cfb.openExecutedBets += 1;
          out.set(cfbKey, cfb);
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const tickets = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id });
    for (const t of tickets || []) {
      if (t.result && t.result !== "OPEN") continue;
      const sport = String(t.sport || "").toLowerCase();
      const date = String(t.date || "").slice(0, 10);
      if (!sport || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const key = keyOf(sport, date);
      const row = out.get(key) || { sport, date, openExecutedBets: 0, openStrategyTickets: 0 };
      row.openStrategyTickets += 1;
      out.set(key, row);
    }
  } catch {
    /* ignore */
  }
  return [...out.values()].sort((a, b) => {
    const aOpen = Number(a.openExecutedBets || 0) + Number(a.openStrategyTickets || 0);
    const bOpen = Number(b.openExecutedBets || 0) + Number(b.openStrategyTickets || 0);
    if (bOpen !== aOpen) return bOpen - aOpen;
    return String(b.date).localeCompare(String(a.date)) || String(a.sport).localeCompare(String(b.sport));
  });
}
