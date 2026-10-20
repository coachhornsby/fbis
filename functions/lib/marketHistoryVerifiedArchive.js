/**
 * Verified market-history archival: R2 put + SHA-256 manifest + optional readback.
 * Never deletes D1 rows. Retention-gate authorization is a separate operator step.
 */
import { sha256Hex } from "./sha256Hex.js";
import { putArchive, r2Bound } from "./r2Archive.js";
import {
  MARKET_HISTORY_HOT_WINDOW_MS,
  listMarketHistoryReadDbs,
  marketHistoryHotCutoff,
  marketHistoryRetentionDecision,
} from "./databaseTopology.js";

export const VERIFIED_ARCHIVE_CONTRACT = "fbis-market-history-verified-archive-v1";
export const VERIFIED_ARCHIVE_PREFIX = "market-history/verified-batches";

function safeTableIdent(name) {
  return /^[a-zA-Z0-9_]+$/.test(String(name || "")) ? String(name) : null;
}

export function verifiedArchiveBatchKey({ partitionKey, batchId }) {
  const day = new Date().toISOString().slice(0, 10);
  const safe = String(batchId || "batch").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `${VERIFIED_ARCHIVE_PREFIX}/${partitionKey || "unknown"}/${day}/${safe}.json`;
}

export function verifiedArchiveManifestKey({ partitionKey, batchId }) {
  return `${verifiedArchiveBatchKey({ partitionKey, batchId }).replace(/\.json$/, "")}.manifest.json`;
}

/**
 * Archive a cold cohort with content-addressed batch body + manifest.
 * When verifyReadback=true, re-get the object and confirm SHA-256 match.
 */
export async function archiveAndVerifyColdMarketHistory(env, {
  now = new Date(),
  limit = 100,
  partitionBinding = "MARKET_HISTORY_2026Q4_DB",
  archiveWrites = false,
  verifyReadback = false,
} = {}) {
  if (!r2Bound(env) && archiveWrites) {
    return {
      contract: VERIFIED_ARCHIVE_CONTRACT,
      ok: false,
      reason: "ARCHIVE_R2_UNBOUND",
      archived: 0,
      verified: false,
      deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
      canAuthorizeWager: false,
    };
  }

  const cutoff = marketHistoryHotCutoff(now);
  const partitions = listMarketHistoryReadDbs(env).filter((p) =>
    !partitionBinding || p.binding === partitionBinding
  );
  if (!partitions.length) {
    return {
      contract: VERIFIED_ARCHIVE_CONTRACT,
      ok: false,
      reason: "MARKET_HISTORY_UNBOUND",
      archived: 0,
      verified: false,
      deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
      canAuthorizeWager: false,
    };
  }

  const part = partitions[0];
  const table = safeTableIdent("normalized_market_observations");
  let rows = [];
  try {
    const page = await part.db.prepare(
      `SELECT id, observation_key, source, sport, canonical_event_id, market_family, side, line, period,
              contract_price, decimal_odds, american_odds, source_market_id, source_outcome_id,
              source_observed_at, collected_at, snapshot_type, raw_payload_json,
              execution_eligible, can_qualify, can_authorize_wager
       FROM ${table}
       WHERE collected_at < ?
       ORDER BY collected_at ASC, id ASC
       LIMIT ?`
    ).bind(cutoff, Math.min(500, Math.max(1, Number(limit) || 100))).all();
    rows = page?.results || [];
  } catch (error) {
    return {
      contract: VERIFIED_ARCHIVE_CONTRACT,
      ok: false,
      reason: String(error?.message || error).slice(0, 240),
      archived: 0,
      verified: false,
      deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
      canAuthorizeWager: false,
    };
  }

  const coldRows = [];
  for (const row of rows) {
    const decision = marketHistoryRetentionDecision({ collectedAt: row.collected_at, now });
    if (!decision.retainInD1) coldRows.push({ ...row, retention: decision });
  }

  if (!coldRows.length) {
    return {
      contract: VERIFIED_ARCHIVE_CONTRACT,
      ok: true,
      dryRun: !archiveWrites,
      cutoff,
      scanned: rows.length,
      archived: 0,
      verified: true,
      reason: "NO_COLD_ROWS_IN_PAGE",
      deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
      canAuthorizeWager: false,
    };
  }

  const batchId = `batch_${coldRows[0].id}_${coldRows.length}`;
  const partitionKey = part.partition?.key || part.binding;
  const body = {
    schemaVersion: 1,
    contract: VERIFIED_ARCHIVE_CONTRACT,
    archiveKind: "market_history_observation_batch",
    partition: partitionKey,
    binding: part.binding,
    archivedAt: now instanceof Date ? now.toISOString() : String(now),
    hotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
    cutoff,
    rowCount: coldRows.length,
    observations: coldRows.map((row) => ({
      ...row,
      can_qualify: 0,
      can_authorize_wager: 0,
    })),
    canAuthorizeWager: false,
  };
  const bodyText = JSON.stringify(body);
  const contentSha256 = sha256Hex(bodyText);
  const objectKey = verifiedArchiveBatchKey({ partitionKey, batchId });
  const manifestKey = verifiedArchiveManifestKey({ partitionKey, batchId });
  const manifest = {
    contract: VERIFIED_ARCHIVE_CONTRACT,
    partition: partitionKey,
    binding: part.binding,
    batchId,
    objectKey,
    contentSha256,
    rowCount: coldRows.length,
    cutoff,
    archivedAt: body.archivedAt,
    observationIds: coldRows.map((r) => r.id),
    retentionReleaseAuthorized: false,
    sourceRowsDeleted: 0,
    canAuthorizeWager: false,
  };

  let putOk = !archiveWrites;
  let readbackVerified = !archiveWrites;
  let readbackSha256 = null;

  if (archiveWrites) {
    const put = await putArchive(env, objectKey, bodyText);
    const putManifest = await putArchive(env, manifestKey, manifest);
    putOk = Boolean(put.ok && putManifest.ok);
    if (putOk && verifyReadback && env.ARCHIVE?.get) {
      try {
        const obj = await env.ARCHIVE.get(objectKey);
        const text = obj && typeof obj.text === "function" ? await obj.text() : null;
        readbackSha256 = text != null ? sha256Hex(text) : null;
        readbackVerified = readbackSha256 === contentSha256;
      } catch {
        readbackVerified = false;
      }
    } else if (putOk && !verifyReadback) {
      readbackVerified = false; // not attempted
    }
  }

  return {
    contract: VERIFIED_ARCHIVE_CONTRACT,
    ok: putOk && (archiveWrites ? (verifyReadback ? readbackVerified : true) : true),
    dryRun: !archiveWrites,
    cutoff,
    scanned: rows.length,
    archived: coldRows.length,
    objectKey,
    manifestKey,
    contentSha256,
    readbackSha256,
    readbackVerified: archiveWrites && verifyReadback ? readbackVerified : null,
    retentionReleaseAuthorized: false,
    deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
    canAuthorizeWager: false,
  };
}
