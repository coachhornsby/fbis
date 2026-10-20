/**
 * Archive market-history observations older than the D1 hot window into R2.
 * Never deletes D1 rows — retention-gate delete is a separate operator step.
 */
import {
  MARKET_HISTORY_HOT_WINDOW_MS,
  listMarketHistoryReadDbs,
  marketHistoryHotCutoff,
  marketHistoryRetentionDecision,
} from "./databaseTopology.js";
import { putArchive, r2Bound } from "./r2Archive.js";

export const MARKET_HISTORY_ARCHIVE_PREFIX = "market-history/observations";

export function marketHistoryArchiveKey({ partitionKey, collectedAt, id }) {
  const day = String(collectedAt || "").slice(0, 10) || "unknown-day";
  const safeId = String(id || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return `${MARKET_HISTORY_ARCHIVE_PREFIX}/${partitionKey || "unknown"}/${day}/${safeId}.json`;
}

/**
 * Scan one history DB for rows outside the hot window and put JSON archives in R2.
 * Dry-run by default (archiveWrites=false). Deletion is never performed here.
 */
export async function archiveColdMarketHistoryObservations(env, {
  now = new Date(),
  limit = 100,
  partitionBinding = null,
  archiveWrites = false,
} = {}) {
  if (!r2Bound(env) && archiveWrites) {
    return { ok: false, reason: "ARCHIVE_R2_UNBOUND", archived: 0, scanned: 0, canAuthorizeWager: false };
  }

  const cutoff = marketHistoryHotCutoff(now);
  const partitions = listMarketHistoryReadDbs(env).filter((p) =>
    !partitionBinding || p.binding === partitionBinding
  );
  if (!partitions.length) {
    return { ok: false, reason: "MARKET_HISTORY_UNBOUND", archived: 0, scanned: 0, canAuthorizeWager: false };
  }

  const results = [];
  let archived = 0;
  let scanned = 0;
  let skippedHot = 0;
  let writeFailures = 0;

  for (const part of partitions) {
    let rows = [];
    try {
      // Prefer full-row verified archive path for production; this scan keeps
      // SELECT * so operator dry-runs never drop schema columns.
      const page = await part.db.prepare(
        `SELECT *
         FROM normalized_market_observations
         WHERE collected_at < ?
         ORDER BY collected_at ASC, id ASC
         LIMIT ?`
      ).bind(cutoff, Math.min(2000, Math.max(1, Number(limit) || 100))).all();
      rows = page?.results || [];
    } catch (error) {
      results.push({
        binding: part.binding,
        ok: false,
        error: String(error?.message || error).slice(0, 240),
      });
      continue;
    }

    const archivedIds = [];
    for (const row of rows) {
      scanned += 1;
      const decision = marketHistoryRetentionDecision({ collectedAt: row.collected_at, now });
      if (decision.retainInD1) {
        skippedHot += 1;
        continue;
      }
      const key = marketHistoryArchiveKey({
        partitionKey: part.partition?.key || part.binding,
        collectedAt: row.collected_at,
        id: row.id,
      });
      const body = {
        schemaVersion: 1,
        archiveKind: "market_history_observation",
        partition: part.partition?.key || part.binding,
        binding: part.binding,
        archivedAt: now.toISOString(),
        hotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
        retention: decision,
        observation: {
          ...row,
          // Authority never upgrades through archive.
          can_qualify: 0,
          can_authorize_wager: 0,
        },
        canAuthorizeWager: false,
      };
      if (archiveWrites) {
        const put = await putArchive(env, key, body);
        if (!put.ok) {
          writeFailures += 1;
          continue;
        }
      }
      archived += 1;
      archivedIds.push({ id: row.id, key, dryRun: !archiveWrites });
    }

    results.push({
      binding: part.binding,
      partition: part.partition?.key || null,
      ok: true,
      scanned: rows.length,
      archived: archivedIds.length,
      sample: archivedIds.slice(0, 5),
    });
  }

  return {
    ok: writeFailures === 0,
    dryRun: !archiveWrites,
    cutoff,
    scanned,
    archived,
    skippedHot,
    writeFailures,
    partitions: results,
    deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
    canAuthorizeWager: false,
  };
}
