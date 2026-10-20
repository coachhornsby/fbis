/**
 * Verified market-history archival: full-row R2 put + SHA-256 manifest + readback.
 * Checkpointed and resumable — never re-archives the same cursor window.
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

export const VERIFIED_ARCHIVE_CONTRACT = "fbis-market-history-verified-archive-v2";
export const VERIFIED_ARCHIVE_PREFIX = "market-history/verified-batches";
export const ARCHIVE_CHECKPOINT_TABLE = "fbis_market_history_archive_checkpoint";
export const ARCHIVE_CHECKPOINT_KEY = "normalized_market_observations_v2";

/** Full Q4 `normalized_market_observations` column set (50). Archives must preserve every column. */
export const NORMALIZED_MARKET_OBSERVATION_COLUMNS = Object.freeze([
  "id",
  "observation_key",
  "source",
  "source_type",
  "sport",
  "league",
  "canonical_event_id",
  "provider_event_id",
  "event_start_time",
  "home_team",
  "away_team",
  "canonical_player_id",
  "provider_player_id",
  "player_name",
  "team",
  "opponent",
  "market_family",
  "stat_family",
  "side",
  "line",
  "american_odds",
  "decimal_odds",
  "contract_price",
  "payout_multiplier",
  "standard_or_alt",
  "promo",
  "period",
  "source_market_id",
  "source_outcome_id",
  "source_observed_at",
  "collected_at",
  "snapshot_type",
  "model_id",
  "model_version",
  "model_probability",
  "fair_american_price",
  "raw_implied_probability",
  "no_vig_market_probability",
  "probability_edge",
  "expected_return_per_unit_risk",
  "execution_eligible",
  "decision_eligible",
  "can_qualify",
  "can_authorize_wager",
  "result_value",
  "result_side",
  "settled_at",
  "raw_payload_json",
  "raw_payload_hash",
  "created_at",
]);

/** Default R2 durable-copy eligibility (1h). D1 deletion still requires 24h hot window + retention gate. */
export const ARCHIVE_ELIGIBILITY_MS_DEFAULT = 60 * 60 * 1000;

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

export function archiveEligibilityCutoff(now = new Date(), eligibilityMs = ARCHIVE_ELIGIBILITY_MS_DEFAULT) {
  const ms = Math.max(60_000, Number(eligibilityMs) || ARCHIVE_ELIGIBILITY_MS_DEFAULT);
  const t = now instanceof Date ? now.getTime() : Date.parse(String(now));
  return new Date(t - ms).toISOString();
}

export function projectObservationForArchive(row) {
  const out = {};
  for (const col of NORMALIZED_MARKET_OBSERVATION_COLUMNS) {
    out[col] = Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null;
  }
  // Evidence archives never carry wager authority.
  out.can_qualify = 0;
  out.can_authorize_wager = 0;
  return out;
}

export function assertFullColumnCoverage(row) {
  const present = NORMALIZED_MARKET_OBSERVATION_COLUMNS.filter((c) =>
    Object.prototype.hasOwnProperty.call(row || {}, c)
  );
  const missing = NORMALIZED_MARKET_OBSERVATION_COLUMNS.filter((c) =>
    !Object.prototype.hasOwnProperty.call(row || {}, c)
  );
  return {
    ok: missing.length === 0 && present.length === NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
    expected: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
    present: present.length,
    missing,
  };
}

/**
 * Compare archived observation to live D1 row for every required column.
 * Authority flags may be forced to 0 in archive; all other values must match.
 */
export function verifyFullRecordRestore(sourceRow, archivedRow) {
  const coverage = assertFullColumnCoverage(archivedRow);
  if (!coverage.ok) {
    return { ok: false, reason: "ARCHIVED_COLUMNS_INCOMPLETE", ...coverage, mismatches: [] };
  }
  const mismatches = [];
  for (const col of NORMALIZED_MARKET_OBSERVATION_COLUMNS) {
    if (col === "can_qualify" || col === "can_authorize_wager") {
      if (Number(archivedRow[col]) !== 0) {
        mismatches.push({ column: col, expected: 0, actual: archivedRow[col] });
      }
      continue;
    }
    const a = sourceRow?.[col] ?? null;
    const b = archivedRow?.[col] ?? null;
    const equal = a === b
      || (a == null && b == null)
      || (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b))
      || String(a) === String(b);
    if (!equal) mismatches.push({ column: col, expected: a, actual: b });
  }
  return {
    ok: mismatches.length === 0,
    reason: mismatches.length ? "COLUMN_VALUE_MISMATCH" : "FULL_RECORD_RESTORE_OK",
    expected: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
    present: coverage.present,
    missing: [],
    mismatches: mismatches.slice(0, 20),
  };
}

async function ensureCheckpointTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ${ARCHIVE_CHECKPOINT_TABLE} (
      checkpoint_key TEXT PRIMARY KEY,
      last_collected_at TEXT NOT NULL DEFAULT '',
      last_id TEXT NOT NULL DEFAULT '',
      archived_total INTEGER NOT NULL DEFAULT 0,
      last_batch_at TEXT,
      last_object_key TEXT,
      last_content_sha256 TEXT,
      last_backlog INTEGER,
      updated_at TEXT NOT NULL
    )`
  ).run();
}

async function readCheckpoint(db) {
  try {
    await ensureCheckpointTable(db);
    const row = await db.prepare(
      `SELECT last_collected_at, last_id, archived_total, last_batch_at, last_object_key, last_content_sha256, last_backlog
       FROM ${ARCHIVE_CHECKPOINT_TABLE} WHERE checkpoint_key=? LIMIT 1`
    ).bind(ARCHIVE_CHECKPOINT_KEY).first();
    return {
      lastCollectedAt: row?.last_collected_at || "",
      lastId: row?.last_id || "",
      archivedTotal: Number(row?.archived_total) || 0,
      lastBatchAt: row?.last_batch_at || null,
      lastObjectKey: row?.last_object_key || null,
      lastContentSha256: row?.last_content_sha256 || null,
      lastBacklog: row?.last_backlog ?? null,
    };
  } catch {
    return {
      lastCollectedAt: "",
      lastId: "",
      archivedTotal: 0,
      lastBatchAt: null,
      lastObjectKey: null,
      lastContentSha256: null,
      lastBacklog: null,
    };
  }
}

async function writeCheckpoint(db, {
  lastCollectedAt,
  lastId,
  archivedTotal,
  lastBatchAt,
  lastObjectKey,
  lastContentSha256,
  lastBacklog,
}) {
  await ensureCheckpointTable(db);
  await db.prepare(
    `INSERT INTO ${ARCHIVE_CHECKPOINT_TABLE}(
       checkpoint_key, last_collected_at, last_id, archived_total,
       last_batch_at, last_object_key, last_content_sha256, last_backlog, updated_at
     ) VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(checkpoint_key) DO UPDATE SET
       last_collected_at=excluded.last_collected_at,
       last_id=excluded.last_id,
       archived_total=excluded.archived_total,
       last_batch_at=excluded.last_batch_at,
       last_object_key=excluded.last_object_key,
       last_content_sha256=excluded.last_content_sha256,
       last_backlog=excluded.last_backlog,
       updated_at=excluded.updated_at`
  ).bind(
    ARCHIVE_CHECKPOINT_KEY,
    String(lastCollectedAt || ""),
    String(lastId || ""),
    Number(archivedTotal) || 0,
    lastBatchAt || null,
    lastObjectKey || null,
    lastContentSha256 || null,
    lastBacklog == null ? null : Number(lastBacklog),
    new Date().toISOString()
  ).run();
}

async function countBacklog(db, table, cutoff, cursorAt, cursorId) {
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM ${table}
       WHERE collected_at < ?
         AND (
           collected_at > ?
           OR (collected_at = ? AND id > ?)
           OR (? = '' AND ? = '')
         )`
    ).bind(cutoff, cursorAt, cursorAt, cursorId, cursorAt, cursorId).first();
    return Number(row?.n) || 0;
  } catch {
    return null;
  }
}

/**
 * Archive eligible cohorts with content-addressed batch body + manifest.
 * Advances a durable D1 checkpoint so subsequent runs never re-scan the same page.
 * When verifyReadback=true, re-get the object, confirm SHA-256, and prove full-column restore.
 */
export async function archiveAndVerifyColdMarketHistory(env, {
  now = new Date(),
  limit = 1000,
  maxRounds = 10,
  partitionBinding = "MARKET_HISTORY_2026Q4_DB",
  archiveWrites = false,
  verifyReadback = false,
  eligibilityMs = ARCHIVE_ELIGIBILITY_MS_DEFAULT,
  resume = true,
  resetCheckpoint = false,
} = {}) {
  const startedMs = Date.now();
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

  const hotCutoff = marketHistoryHotCutoff(now);
  const eligibilityCutoff = archiveEligibilityCutoff(now, eligibilityMs);
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
  const pageSize = Math.min(2000, Math.max(1, Number(limit) || 1000));
  const roundsN = Math.min(50, Math.max(1, Number(maxRounds) || 10));
  const columnSql = NORMALIZED_MARKET_OBSERVATION_COLUMNS.join(", ");

  let checkpoint = resume ? await readCheckpoint(part.db) : {
    lastCollectedAt: "",
    lastId: "",
    archivedTotal: 0,
    lastBatchAt: null,
    lastObjectKey: null,
    lastContentSha256: null,
    lastBacklog: null,
  };
  if (resetCheckpoint) {
    checkpoint = {
      lastCollectedAt: "",
      lastId: "",
      archivedTotal: 0,
      lastBatchAt: null,
      lastObjectKey: null,
      lastContentSha256: null,
      lastBacklog: null,
    };
  }

  const backlogBefore = await countBacklog(
    part.db,
    table,
    eligibilityCutoff,
    checkpoint.lastCollectedAt,
    checkpoint.lastId
  );

  const batches = [];
  let archived = 0;
  let scanned = 0;
  let moreRemaining = false;
  let lastRestoreProof = null;
  let cursorAt = checkpoint.lastCollectedAt;
  let cursorId = checkpoint.lastId;
  let lastObjectKey = checkpoint.lastObjectKey;
  let lastContentSha256 = checkpoint.lastContentSha256;

  for (let round = 0; round < roundsN; round += 1) {
    let rows = [];
    try {
      const page = await part.db.prepare(
        `SELECT ${columnSql}
         FROM ${table}
         WHERE collected_at < ?
           AND (
             collected_at > ?
             OR (collected_at = ? AND id > ?)
             OR (? = '' AND ? = '')
           )
         ORDER BY collected_at ASC, id ASC
         LIMIT ?`
      ).bind(
        eligibilityCutoff,
        cursorAt,
        cursorAt,
        cursorId,
        cursorAt,
        cursorId,
        pageSize
      ).all();
      rows = page?.results || [];
    } catch (error) {
      return {
        contract: VERIFIED_ARCHIVE_CONTRACT,
        ok: false,
        reason: String(error?.message || error).slice(0, 240),
        archived,
        scanned,
        verified: false,
        checkpoint,
        deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
        canAuthorizeWager: false,
      };
    }

    if (!rows.length) {
      moreRemaining = false;
      break;
    }
    scanned += rows.length;
    moreRemaining = rows.length >= pageSize;

    const coverage = assertFullColumnCoverage(rows[0]);
    if (!coverage.ok) {
      return {
        contract: VERIFIED_ARCHIVE_CONTRACT,
        ok: false,
        reason: "SOURCE_COLUMNS_INCOMPLETE",
        columnCoverage: coverage,
        archived,
        scanned,
        deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
        canAuthorizeWager: false,
      };
    }

    const coldRows = rows.map((row) => {
      const projected = projectObservationForArchive(row);
      const retention = marketHistoryRetentionDecision({ collectedAt: row.collected_at, now });
      return {
        ...projected,
        retention,
        eligibleForD1Deletion: retention.retainInD1 !== true
          && String(row.collected_at) < hotCutoff,
      };
    });

    const batchId = `batch_${coldRows[0].id}_${coldRows.length}_r${round + 1}`;
    const partitionKey = part.partition?.key || part.binding;
    const body = {
      schemaVersion: 2,
      contract: VERIFIED_ARCHIVE_CONTRACT,
      archiveKind: "market_history_observation_batch_full_row",
      partition: partitionKey,
      binding: part.binding,
      archivedAt: now instanceof Date ? now.toISOString() : String(now),
      hotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
      eligibilityMs: Math.max(60_000, Number(eligibilityMs) || ARCHIVE_ELIGIBILITY_MS_DEFAULT),
      eligibilityCutoff,
      hotCutoff,
      columnCount: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
      columns: NORMALIZED_MARKET_OBSERVATION_COLUMNS.slice(),
      rowCount: coldRows.length,
      observations: coldRows,
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
      columnCount: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
      columns: NORMALIZED_MARKET_OBSERVATION_COLUMNS.slice(),
      eligibilityCutoff,
      hotCutoff,
      archivedAt: body.archivedAt,
      observationIds: coldRows.map((r) => r.id),
      cursorAfter: {
        collected_at: coldRows[coldRows.length - 1].collected_at,
        id: coldRows[coldRows.length - 1].id,
      },
      retentionReleaseAuthorized: false,
      sourceRowsDeleted: 0,
      canAuthorizeWager: false,
    };

    let putOk = !archiveWrites;
    let readbackVerified = !archiveWrites;
    let readbackSha256 = null;
    let restoreProof = null;

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
          if (readbackVerified && text) {
            const parsed = JSON.parse(text);
            const archivedObs = parsed?.observations?.[0];
            restoreProof = verifyFullRecordRestore(rows[0], archivedObs);
            if (!restoreProof.ok) readbackVerified = false;
          }
        } catch {
          readbackVerified = false;
        }
      } else if (putOk && !verifyReadback) {
        readbackVerified = false;
      }
    } else {
      // Dry-run still proves column projection + restore shape against in-memory body.
      restoreProof = verifyFullRecordRestore(rows[0], coldRows[0]);
    }

    if (archiveWrites && (!putOk || (verifyReadback && !readbackVerified))) {
      return {
        contract: VERIFIED_ARCHIVE_CONTRACT,
        ok: false,
        reason: !putOk ? "R2_PUT_FAILED" : "READBACK_OR_RESTORE_FAILED",
        dryRun: false,
        cutoff: eligibilityCutoff,
        eligibilityCutoff,
        hotCutoff,
        scanned,
        archived,
        batches,
        fullColumnRestore: restoreProof,
        contentSha256,
        readbackSha256,
        readbackVerified,
        checkpoint: {
          lastCollectedAt: cursorAt,
          lastId: cursorId,
          archivedTotal: checkpoint.archivedTotal + archived,
        },
        deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
        canAuthorizeWager: false,
      };
    }

    const last = coldRows[coldRows.length - 1];
    cursorAt = last.collected_at;
    cursorId = last.id;
    archived += coldRows.length;
    lastObjectKey = objectKey;
    lastContentSha256 = contentSha256;
    lastRestoreProof = restoreProof;
    batches.push({
      round: round + 1,
      archived: coldRows.length,
      objectKey,
      manifestKey,
      contentSha256,
      readbackVerified: archiveWrites && verifyReadback ? readbackVerified : null,
      cursorAfter: { collected_at: cursorAt, id: cursorId },
    });

    if (archiveWrites) {
      await writeCheckpoint(part.db, {
        lastCollectedAt: cursorAt,
        lastId: cursorId,
        archivedTotal: checkpoint.archivedTotal + archived,
        lastBatchAt: body.archivedAt,
        lastObjectKey: objectKey,
        lastContentSha256: contentSha256,
        lastBacklog: backlogBefore == null ? null : Math.max(0, backlogBefore - archived),
      });
    }

    if (!moreRemaining) break;
  }

  const backlogAfter = await countBacklog(part.db, table, eligibilityCutoff, cursorAt, cursorId);
  const elapsedMs = Math.max(1, Date.now() - startedMs);
  const throughputRowsPerSec = archived / (elapsedMs / 1000);

  return {
    contract: VERIFIED_ARCHIVE_CONTRACT,
    ok: true,
    dryRun: !archiveWrites,
    cutoff: eligibilityCutoff,
    eligibilityCutoff,
    hotCutoff,
    eligibilityMs: Math.max(60_000, Number(eligibilityMs) || ARCHIVE_ELIGIBILITY_MS_DEFAULT),
    hotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
    columnCount: NORMALIZED_MARKET_OBSERVATION_COLUMNS.length,
    columns: NORMALIZED_MARKET_OBSERVATION_COLUMNS.slice(),
    scanned,
    archived,
    batches,
    rounds: batches.length,
    moreRemaining,
    backlogBefore,
    backlogAfter,
    throughputRowsPerSec: Math.round(throughputRowsPerSec * 100) / 100,
    elapsedMs,
    objectKey: lastObjectKey,
    contentSha256: lastContentSha256,
    readbackVerified: archiveWrites && verifyReadback
      ? batches.every((b) => b.readbackVerified === true)
      : null,
    fullColumnRestore: lastRestoreProof,
    checkpoint: {
      lastCollectedAt: cursorAt,
      lastId: cursorId,
      archivedTotal: checkpoint.archivedTotal + archived,
      lastObjectKey,
      lastContentSha256,
    },
    retentionReleaseAuthorized: false,
    deletion: "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
    canAuthorizeWager: false,
    reason: archived === 0 ? "NO_ELIGIBLE_ROWS_PAST_CHECKPOINT" : undefined,
  };
}
