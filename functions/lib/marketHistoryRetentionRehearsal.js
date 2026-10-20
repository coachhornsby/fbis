/**
 * Bounded source-retirement REHEARSAL — never deletes production rows.
 * Builds an authorized-cohort candidate package with completeness checks,
 * decision/CLV protection probes, and independent restore evidence slots.
 * Final deletion requires evaluateRetentionRelease + explicit operator auth.
 */
import {
  NORMALIZED_MARKET_OBSERVATION_COLUMNS,
  ARCHIVE_CHECKPOINT_KEY,
  archiveEligibilityCutoff,
  ARCHIVE_ELIGIBILITY_MS_DEFAULT,
  verifyFullRecordRestore,
  projectObservationForArchive,
} from "./marketHistoryVerifiedArchive.js";
import {
  MARKET_HISTORY_HOT_WINDOW_MS,
  listMarketHistoryReadDbs,
  marketHistoryHotCutoff,
  marketHistoryRetentionDecision,
} from "./databaseTopology.js";
import { evaluateRetentionRelease } from "./retentionGate.js";
import { sha256Hex } from "./sha256Hex.js";
import { r2Bound } from "./r2Archive.js";

export const RETENTION_REHEARSAL_CONTRACT = "fbis-market-history-retention-rehearsal-v1";

async function loadCheckpoint(db) {
  try {
    return await db.prepare(
      `SELECT last_collected_at, last_id, archived_total, last_object_key, last_content_sha256, last_batch_at
       FROM fbis_market_history_archive_checkpoint WHERE checkpoint_key=? LIMIT 1`
    ).bind(ARCHIVE_CHECKPOINT_KEY).first();
  } catch {
    return null;
  }
}

/**
 * Propose a bounded retirement cohort that is fully archived past the hot window.
 * Does NOT delete. Returns gate evaluation (expected unauthorized without explicit flags).
 */
export async function rehearseMarketHistoryRetirement(env, {
  now = new Date(),
  limit = 100,
  partitionBinding = "MARKET_HISTORY_2026Q4_DB",
  requireDecisionProtection = true,
} = {}) {
  const partitions = listMarketHistoryReadDbs(env).filter((p) =>
    !partitionBinding || p.binding === partitionBinding
  );
  if (!partitions.length) {
    return {
      contract: RETENTION_REHEARSAL_CONTRACT,
      ok: false,
      reason: "MARKET_HISTORY_UNBOUND",
      deletion: "NOT_PERFORMED",
      canAuthorizeWager: false,
    };
  }
  const part = partitions[0];
  const hotCutoff = marketHistoryHotCutoff(now);
  const checkpoint = await loadCheckpoint(part.db);
  if (!checkpoint?.last_collected_at) {
    return {
      contract: RETENTION_REHEARSAL_CONTRACT,
      ok: false,
      reason: "ARCHIVE_CHECKPOINT_MISSING",
      deletion: "NOT_PERFORMED",
      canAuthorizeWager: false,
    };
  }

  // Eligible for retirement consideration: collected_at < hotCutoff AND <= checkpoint cursor
  // (must already be archived past the monotonic cursor).
  const page = await part.db.prepare(
    `SELECT ${NORMALIZED_MARKET_OBSERVATION_COLUMNS.join(", ")}
     FROM normalized_market_observations
     WHERE collected_at < ?
       AND (
         collected_at < ?
         OR (collected_at = ? AND id <= ?)
       )
     ORDER BY collected_at ASC, id ASC
     LIMIT ?`
  ).bind(
    hotCutoff,
    checkpoint.last_collected_at,
    checkpoint.last_collected_at,
    checkpoint.last_id,
    Math.min(500, Math.max(1, Number(limit) || 100))
  ).all();

  const rows = page?.results || [];
  const cohort = [];
  const protectedRows = [];
  for (const row of rows) {
    const retention = marketHistoryRetentionDecision({ collectedAt: row.collected_at, now });
    if (retention.retainInD1) continue;
    // Decision / settlement protection: skip rows with settlement or decision eligibility.
    const protectedHit = requireDecisionProtection && (
      Number(row.decision_eligible) === 1
      || (row.settled_at != null && String(row.settled_at).length > 0)
      || Number(row.can_authorize_wager) === 1
    );
    if (protectedHit) {
      protectedRows.push({ id: row.id, reason: "DECISION_OR_SETTLEMENT_PROTECTION" });
      continue;
    }
    cohort.push(row);
  }

  const projected = cohort.map((r) => projectObservationForArchive(r));
  const restoreSample = cohort[0]
    ? verifyFullRecordRestore(cohort[0], projected[0])
    : { ok: true, reason: "EMPTY_COHORT" };

  const cohortManifest = {
    contract: RETENTION_REHEARSAL_CONTRACT,
    cohortKey: `q4-retire-${hotCutoff.slice(0, 10)}-${cohort[0]?.id || "empty"}-${cohort.length}`,
    generatedAt: now instanceof Date ? now.toISOString() : String(now),
    partition: part.partition?.key || part.binding,
    hotCutoff,
    hotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
    checkpoint: {
      lastCollectedAt: checkpoint.last_collected_at,
      lastId: checkpoint.last_id,
      archivedTotal: checkpoint.archived_total,
      lastObjectKey: checkpoint.last_object_key,
      lastContentSha256: checkpoint.last_content_sha256,
    },
    rowCount: cohort.length,
    observationIds: cohort.map((r) => r.id),
    contentSha256: sha256Hex(JSON.stringify(projected)),
    columnCount: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
    protectedSkipped: protectedRows.length,
    protectedSample: protectedRows.slice(0, 10),
    fullColumnRestoreSample: restoreSample,
    r2ArchivePresent: Boolean(checkpoint.last_object_key),
    r2Bound: r2Bound(env),
    sourceRowsDeleted: 0,
    retentionReleaseAuthorized: false,
    canAuthorizeWager: false,
    deletion: "NOT_PERFORMED_REQUIRES_EXPLICIT_AUTHORIZATION",
  };

  const gate = evaluateRetentionRelease({
    r2ArchiveVerified: Boolean(checkpoint.last_content_sha256),
    r2ReadbackSha256: checkpoint.last_content_sha256 || null,
    independentRestoreVerified: restoreSample.ok === true && cohort.length > 0,
    consumerAuditComplete: false, // must be completed by operator before auth
    retentionReleaseAuthorized: false,
    sourceRowsDeleted: 0,
    sourceDatabase: "fbis-market-history-2026q4",
    cohortKey: cohortManifest.cohortKey,
    newReleaseManifest: true,
  });

  return {
    contract: RETENTION_REHEARSAL_CONTRACT,
    ok: true,
    dryRun: true,
    cohort: cohortManifest,
    gate: {
      authorized: gate.authorized,
      canDeleteSourceRows: gate.canDeleteSourceRows,
      failedChecks: gate.failedChecks,
      blockedReason: gate.blockedReason,
    },
    eligibilityCutoff: archiveEligibilityCutoff(now, ARCHIVE_ELIGIBILITY_MS_DEFAULT),
    scanned: rows.length,
    eligibleForRetirementConsideration: cohort.length,
    protectedSkipped: protectedRows.length,
    deletion: "NOT_PERFORMED_REQUIRES_EXPLICIT_AUTHORIZATION",
    canAuthorizeWager: false,
    nextOperatorStep: gate.authorized
      ? "UNEXPECTED_GATE_OPEN — investigate before any delete"
      : "Complete consumer audit + independent restore + explicit retentionReleaseAuthorized before delete",
  };
}
