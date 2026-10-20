/**
 * Consolidated operator view: storage, migration, reliability.
 * Read-only; never authorizes wagers or deletions.
 */
import {
  D1_HARD_LIMIT_BYTES,
  capacityAlertLevel,
  DATABASE_OWNERS,
} from "./databaseOwnership.js";
import { SPORT_DATABASES, MARKET_HISTORY_HOT_WINDOW_MS } from "./databaseTopology.js";
import {
  ARCHIVE_CHECKPOINT_KEY,
  ARCHIVE_ELIGIBILITY_MS_DEFAULT,
  archiveEligibilityCutoff,
  NORMALIZED_MARKET_OBSERVATION_COLUMNS,
} from "./marketHistoryVerifiedArchive.js";
import { SPORT_WORKING_TABLES, SPORT_PREFIX_TABLES } from "./sportWorkingCopy.js";
import { buildAllSportSyncHealth } from "./sportMigrationQualify.js";
import { readCrossSportBoardSummary } from "./coreBoardSummaries.js";

export const CAPACITY_OPS_DASHBOARD_CONTRACT = "fbis-capacity-ops-dashboard-v1";

async function d1Bytes(db) {
  if (!db?.prepare) return null;
  try {
    const probe = await db.prepare("SELECT 1 AS healthy").all();
    const n = Number(probe?.meta?.size_after);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function count(db, sql, ...params) {
  if (!db?.prepare) return null;
  try {
    const stmt = db.prepare(sql);
    const row = params.length ? await stmt.bind(...params).first() : await stmt.first();
    return Number(row?.n) || 0;
  } catch {
    return null;
  }
}

function summarizeBytes(bytes, key) {
  if (bytes == null) return { databaseKey: key, usedBytes: null, state: "UNBOUND" };
  const alert = capacityAlertLevel(bytes, D1_HARD_LIMIT_BYTES);
  return {
    databaseKey: key,
    usedBytes: alert.usedBytes,
    hardLimitBytes: alert.hardLimitBytes,
    remainingBytes: alert.remainingBytes,
    percentUsed: alert.percentUsed,
    alertLevel: alert.level,
    state: alert.level,
  };
}

export async function buildCapacityOpsDashboard(env, { now = new Date() } = {}) {
  const primaryBytes = await d1Bytes(env?.DB);
  const legacyBytes = await d1Bytes(env?.MARKET_HISTORY_DB);
  const q4Bytes = await d1Bytes(env?.MARKET_HISTORY_2026Q4_DB);
  const opsBytes = await d1Bytes(env?.OPERATIONS_DB);

  const q4 = env?.MARKET_HISTORY_2026Q4_DB;
  let checkpoint = null;
  let backlog = null;
  let totalObs = null;
  let lms = null;
  let hourly = [];
  if (q4?.prepare) {
    try {
      checkpoint = await q4.prepare(
        `SELECT * FROM fbis_market_history_archive_checkpoint WHERE checkpoint_key=? LIMIT 1`
      ).bind(ARCHIVE_CHECKPOINT_KEY).first();
    } catch { /* missing */ }
    totalObs = await count(q4, "SELECT COUNT(*) AS n FROM normalized_market_observations");
    lms = await count(q4, "SELECT COUNT(*) AS n FROM latest_market_state");
    try {
      const eligibilityCutoff = archiveEligibilityCutoff(now, ARCHIVE_ELIGIBILITY_MS_DEFAULT);
      const cursorAt = checkpoint?.last_collected_at || "";
      const cursorId = checkpoint?.last_id || "";
      backlog = await count(
        q4,
        `SELECT COUNT(*) AS n FROM normalized_market_observations
         WHERE collected_at < ?
           AND (collected_at > ? OR (collected_at = ? AND id > ?) OR (? = '' AND ? = ''))`,
        eligibilityCutoff,
        cursorAt,
        cursorAt,
        cursorId,
        cursorAt,
        cursorId
      );
    } catch { backlog = null; }
    try {
      const page = await q4.prepare(
        `SELECT substr(collected_at,1,13) AS hour, COUNT(*) AS n
         FROM normalized_market_observations
         WHERE collected_at >= datetime('now','-6 hours')
         GROUP BY 1 ORDER BY 1`
      ).all();
      hourly = page?.results || [];
    } catch { hourly = []; }
  }

  const sports = [];
  for (const [sport, plan] of Object.entries(SPORT_DATABASES)) {
    const sportDb = plan?.binding ? env?.[plan.binding] : null;
    const entry = {
      sport,
      databaseName: plan.databaseName,
      binding: plan.binding,
      bound: Boolean(sportDb?.prepare),
      workingSet: {},
      prefixTablesPresent: 0,
      prefixTablesExpected: (SPORT_PREFIX_TABLES[sport] || []).length,
      authority: "PRIMARY",
      cutoverReadiness: "BLOCKED",
    };
    if (sportDb?.prepare && env?.DB?.prepare) {
      for (const spec of SPORT_WORKING_TABLES) {
        const p = await count(env.DB, `SELECT COUNT(*) AS n FROM ${spec.table} WHERE sport=?`, sport);
        const s = await count(sportDb, `SELECT COUNT(*) AS n FROM ${spec.table} WHERE sport=?`, sport);
        entry.workingSet[spec.table] = {
          primary: p,
          sport: s,
          parity: p != null && s != null && p === s,
        };
      }
      let present = 0;
      for (const table of SPORT_PREFIX_TABLES[sport] || []) {
        try {
          await sportDb.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).first();
          present += 1;
        } catch { /* missing */ }
      }
      entry.prefixTablesPresent = present;
      const workingOk = Object.values(entry.workingSet).every((v) => v.parity === true);
      entry.projectionParity = workingOk ? "PASS_WORKING_SET" : "DIVERGED";
      entry.cutoverReadiness = workingOk && present > 0 ? "SHADOW_PARTIAL" : workingOk ? "WORKING_SET_ONLY" : "BLOCKED";
    }
    sports.push(entry);
  }

  let core = { ok: false, reason: "UNREAD" };
  try {
    core = await readCrossSportBoardSummary(env, { requireFresh: true, maxAgeMs: 15 * 60 * 1000 });
  } catch (error) {
    core = { ok: false, reason: String(error?.message || error).slice(0, 200) };
  }

  let sportSync = null;
  try {
    sportSync = await buildAllSportSyncHealth(env, { now });
  } catch (error) {
    sportSync = { ok: false, reason: String(error?.message || error).slice(0, 200) };
  }

  const latestHour = hourly.length ? hourly[hourly.length - 1] : null;
  const ingestRowsPerHourApprox = latestHour
    ? Math.round((Number(latestHour.n) || 0) * (60 / Math.max(1, new Date(now).getUTCMinutes() || 60)))
    : null;

  return {
    contract: CAPACITY_OPS_DASHBOARD_CONTRACT,
    generatedAt: now instanceof Date ? now.toISOString() : String(now),
    canAuthorizeWager: false,
    storage: {
      hardLimitBytes: D1_HARD_LIMIT_BYTES,
      databases: {
        primary: summarizeBytes(primaryBytes, DATABASE_OWNERS.PRIMARY?.databaseName || "fbis"),
        legacyMarketHistory: summarizeBytes(legacyBytes, "fbis-market-history"),
        marketHistoryQ4: summarizeBytes(q4Bytes, "fbis-market-history-2026q4"),
        operations: summarizeBytes(opsBytes, "fbis-operations"),
      },
      q4: {
        totalObservations: totalObs,
        latestMarketStateRows: lms,
        hourlyIngest: hourly,
        ingestRowsPerHourApprox,
        archive: {
          checkpoint,
          backlogEligible: backlog,
          archivedTotal: checkpoint?.archived_total ?? null,
          lastBatchAt: checkpoint?.last_batch_at ?? null,
          columnCountExpected: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
          hotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
          eligibilityMs: ARCHIVE_ELIGIBILITY_MS_DEFAULT,
          storageReclaimedBytes: 0,
          deletionAuthorized: false,
        },
      },
    },
    migration: {
      sports,
      sportSync,
      authorityPolicy: "PRIMARY remains authoritative until per-sport cutover approval",
      cutoverAuthorized: false,
      deletionAuthorized: false,
    },
    reliability: {
      coreBoard: {
        ok: core?.ok === true,
        asOf: core?.asOf || core?.summary?.asOf || null,
        ageMs: core?.freshness?.ageMs ?? core?.ageMs ?? null,
        sportCount: Array.isArray(core?.summary?.sports) ? core.summary.sports.length : core?.sportCount ?? null,
        reason: core?.reason || core?.freshness?.reason || null,
      },
      archiveDeletionAuthorized: false,
    },
  };
}
