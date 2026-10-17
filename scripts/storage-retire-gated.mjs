#!/usr/bin/env node
/**
 * Gated primary D1 retirement.
 * Default: DRY_RUN (COUNT + size only). APPLY requires:
 *   STORAGE_RETIRE_APPLY=true
 *   STORAGE_RETIRE_RELEASE_ID matching an authorized retention package
 * Never targets MARKET_HISTORY_DB. Never touches CURRENT or CFB 2004.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PRIMARY_DB,
  COLD_DB,
  MARKET_HISTORY_DB,
  SAFE_RETIREMENT_CANDIDATES,
  PROTECTED_UNTIL_SEPARATE_RELEASE,
  assertNotLiveMarketHistoryTarget,
  assertApplyMode,
  assertRetentionPackageAllowsApply,
  countSql,
  deleteBatchSql,
  protectedCountSql,
} from "./lib/storage-retire-gates.mjs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const out = process.env.RETIRE_OUTPUT || "/tmp/fbis-storage-retire";
const packagePath =
  process.env.STORAGE_RETIRE_PACKAGE ||
  resolve("docs/storage-retention-release-authorized-20261017.json");
const batchLimit = Number(process.env.STORAGE_RETIRE_BATCH || 500);
const maxBatches = Number(process.env.STORAGE_RETIRE_MAX_BATCHES || 50);

if (!token || !account) throw new Error("CREDENTIALS_REQUIRED");

const mode = assertApplyMode(process.env);
assertNotLiveMarketHistoryTarget(PRIMARY_DB);
assertNotLiveMarketHistoryTarget(COLD_DB);
if (PRIMARY_DB === MARKET_HISTORY_DB) throw new Error("PRIMARY_IS_LIVE_HISTORY");

const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { Authorization: `Bearer ${token}` };
const evidence = {
  contract: "fbis-storage-retire-gated-v1",
  startedAt: new Date().toISOString(),
  mode: mode.mode,
  releaseId: mode.releaseId || null,
  primaryDb: PRIMARY_DB,
  coldDb: COLD_DB,
  sourceRowsDeleted: 0,
  sourceDbMutations: 0,
  retentionReleaseAuthorized: false,
  completed: false,
  cohorts: [],
};

async function api(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error("CLOUDFLARE_API_" + res.status + ":" + JSON.stringify(data.errors || data));
  return data.result;
}

async function query(dbId, sql, { allowWrite = false } = {}) {
  if (!allowWrite && !/^(SELECT|PRAGMA)\b/i.test(sql)) throw new Error("READ_ONLY_SQL");
  if (allowWrite && !/^DELETE\b/i.test(sql)) throw new Error("WRITE_MUST_BE_DELETE");
  const r = await api(`/d1/database/${dbId}/query`, { sql });
  const row = r[0];
  if (!row?.success) throw new Error("QUERY_FAILED");
  if (!allowWrite && (row.meta?.changed_db || row.meta?.rows_written)) throw new Error("READ_ONLY_ASSERTION_FAILED");
  return row;
}

async function dbDetail(dbId) {
  return api(`/d1/database/${dbId}`);
}

await mkdir(out, { recursive: true });

try {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  evidence.packagePath = packagePath;
  evidence.packageStatus = pkg.status || null;
  evidence.retentionReleaseAuthorized = pkg.retentionReleaseAuthorized === true;

  if (mode.apply) {
    assertRetentionPackageAllowsApply(pkg, mode.releaseId);
  }

  evidence.primaryStart = await dbDetail(PRIMARY_DB);
  evidence.coldStart = await dbDetail(COLD_DB);

  // Protected cohort must remain present on primary (we never delete it here).
  for (const p of PROTECTED_UNTIL_SEPARATE_RELEASE) {
    const row = await query(PRIMARY_DB, protectedCountSql(p.id));
    evidence.protected = evidence.protected || [];
    evidence.protected.push({ id: p.id, primaryCount: row.results[0].n });
  }

  // Live CURRENT must remain (sanity: count CURRENT rows; must be > 0 if research table exists).
  const current = await query(
    PRIMARY_DB,
    "SELECT COUNT(*) AS n FROM normalized_market_observations WHERE snapshot_type = 'CURRENT'"
  );
  evidence.currentRowsOnPrimary = current.results[0].n;

  for (const c of SAFE_RETIREMENT_CANDIDATES) {
    const primaryCount = (await query(PRIMARY_DB, countSql(c.id))).results[0].n;
    let coldCount = null;
    try {
      coldCount = (await query(COLD_DB, countSql(c.id))).results[0].n;
    } catch (e) {
      coldCount = { error: e.message };
    }
    const cohort = {
      id: c.id,
      table: c.table,
      predicate: c.predicate,
      expectedArchivedIds: c.expectedArchivedIds,
      primaryCount,
      coldCount,
      deleted: 0,
      batches: 0,
    };
    if (typeof coldCount === "number" && coldCount < c.expectedArchivedIds * 0.99) {
      cohort.blockApply = "COLD_COUNT_BELOW_ARCHIVE_EXPECTATION";
    }
    evidence.cohorts.push(cohort);
  }

  if (mode.apply) {
    for (const cohort of evidence.cohorts) {
      if (cohort.blockApply) throw new Error(cohort.blockApply + ":" + cohort.id);
      let deleted = 0;
      for (let i = 0; i < maxBatches; i++) {
        const sql = deleteBatchSql(cohort.id, batchLimit);
        const row = await query(PRIMARY_DB, sql, { allowWrite: true });
        const n = Number(row.meta?.changes || row.meta?.rows_written || 0);
        deleted += n;
        cohort.batches += 1;
        evidence.sourceDbMutations += 1;
        evidence.sourceRowsDeleted += n;
        cohort.deleted = deleted;
        if (n === 0) break;
        // Remeasure every batch; stop early if size is not moving after several deletes.
        if (i > 0 && i % 5 === 0) {
          const mid = await dbDetail(PRIMARY_DB);
          cohort.lastPhysicalBytes = mid.file_size;
        }
      }
      cohort.primaryCountAfter = (await query(PRIMARY_DB, countSql(cohort.id))).results[0].n;
    }
    // Re-check protected + CURRENT after deletes
    for (const p of PROTECTED_UNTIL_SEPARATE_RELEASE) {
      const row = await query(PRIMARY_DB, protectedCountSql(p.id));
      const before = evidence.protected.find((x) => x.id === p.id)?.primaryCount;
      if (row.results[0].n !== before) throw new Error("PROTECTED_COHORT_CHANGED_" + p.id);
    }
    const currentAfter = await query(
      PRIMARY_DB,
      "SELECT COUNT(*) AS n FROM normalized_market_observations WHERE snapshot_type = 'CURRENT'"
    );
    // Concurrent writers may insert CURRENT while APPLY runs; never allow CURRENT to shrink.
    if (currentAfter.results[0].n < evidence.currentRowsOnPrimary) {
      throw new Error("CURRENT_ROWS_DECREASED");
    }
    evidence.currentRowsOnPrimaryAfter = currentAfter.results[0].n;
  }

  evidence.primaryEnd = await dbDetail(PRIMARY_DB);
  evidence.physicalBytesReclaimed =
    (evidence.primaryStart.file_size || 0) - (evidence.primaryEnd.file_size || 0);
  evidence.completed = true;
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(out + "/result.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify({
      completed: evidence.completed,
      mode: evidence.mode,
      sourceRowsDeleted: evidence.sourceRowsDeleted,
      physicalBytesReclaimed: evidence.physicalBytesReclaimed ?? null,
      primaryBytes: evidence.primaryEnd?.file_size ?? evidence.primaryStart?.file_size ?? null,
      error: evidence.error || null,
      cohorts: evidence.cohorts.map((c) => ({
        id: c.id,
        primaryCount: c.primaryCount,
        coldCount: c.coldCount,
        deleted: c.deleted,
      })),
    })
  );
}
