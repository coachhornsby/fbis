/** Gates for primary D1 retirement. No DELETE without verified cold+R2(+Drive) evidence. */
export const PRIMARY_DB = "b50c724c-903b-4241-8ce1-48d931e7a44c";
export const COLD_DB = "6fad1baf-126f-4ab8-9b80-a7d71637d6d4";
export const MARKET_HISTORY_DB = "c32ccf06-c896-4d24-bb89-3e87a7412899"; // live WS — never retire into/from as cold sole owner

/** Cohorts that may be proposed for retirement after full archive verification. */
export const SAFE_RETIREMENT_CANDIDATES = Object.freeze([
  {
    id: "market-research-frozen-20261017",
    table: "normalized_market_observations",
    // Live CURRENT / prospective evidence stays on primary.
    predicate: "snapshot_type = 'RESEARCH' AND rowid <= 667201",
    protectLive: true,
    expectedArchivedIds: 497624,
    notes: "Frozen RESEARCH only; never CURRENT or post-cutoff WS rows.",
  },
  {
    id: "cfb-roster-obs-2005-2025",
    table: "cfb_roster_observations",
    predicate: "season BETWEEN 2005 AND 2025",
    protectLive: true,
    expectedArchivedIds: 430971,
    notes: "2004 remains separately gated unless package explicitly includes verified R2 season archive.",
  },
]);

export const PROTECTED_UNTIL_SEPARATE_RELEASE = Object.freeze([
  {
    id: "cfb-roster-2004",
    table: "cfb_roster_observations",
    predicate: "season = 2004",
    reason: "Immutable cold-pilot manifest retentionReleaseAuthorized:false unless new release overrides.",
  },
]);

export function assertNotLiveMarketHistoryTarget(dbId) {
  if (dbId === MARKET_HISTORY_DB) {
    throw new Error("REFUSE_RETIRE_AGAINST_LIVE_MARKET_HISTORY_SHARD");
  }
}

export function assertApplyMode(env) {
  if (env.STORAGE_RETIRE_APPLY !== "true") {
    return { apply: false, mode: "DRY_RUN" };
  }
  if (env.STORAGE_RETIRE_RELEASE_ID == null || String(env.STORAGE_RETIRE_RELEASE_ID).length < 8) {
    throw new Error("RELEASE_ID_REQUIRED_FOR_APPLY");
  }
  return { apply: true, mode: "APPLY", releaseId: String(env.STORAGE_RETIRE_RELEASE_ID) };
}

/** Refuse APPLY unless the release package is explicitly authorized for this releaseId. */
export function assertRetentionPackageAllowsApply(pkg, releaseId) {
  if (!pkg || pkg.contract !== "fbis-retention-release-package-v1") {
    throw new Error("INVALID_RETENTION_PACKAGE_CONTRACT");
  }
  if (pkg.retentionReleaseAuthorized !== true) {
    throw new Error("RETENTION_RELEASE_NOT_AUTHORIZED");
  }
  if (!pkg.releaseId || String(pkg.releaseId) !== String(releaseId)) {
    throw new Error("RELEASE_ID_MISMATCH");
  }
  if (pkg.primaryDb && pkg.primaryDb !== PRIMARY_DB) {
    throw new Error("PRIMARY_DB_MISMATCH");
  }
  return true;
}

function requireCandidate(id) {
  const candidate = SAFE_RETIREMENT_CANDIDATES.find((c) => c.id === id);
  if (!candidate) throw new Error("UNKNOWN_CANDIDATE_" + id);
  return candidate;
}

export function countSql(candidateId) {
  const c = requireCandidate(candidateId);
  return `SELECT COUNT(*) AS n FROM ${c.table} WHERE ${c.predicate}`;
}

export function deleteBatchSql(candidateId, limit = 500) {
  const c = requireCandidate(candidateId);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("INVALID_BATCH_LIMIT");
  return `DELETE FROM ${c.table} WHERE rowid IN (SELECT rowid FROM ${c.table} WHERE ${c.predicate} ORDER BY rowid LIMIT ${limit})`;
}

export function protectedCountSql(protectedId) {
  const p = PROTECTED_UNTIL_SEPARATE_RELEASE.find((x) => x.id === protectedId);
  if (!p) throw new Error("UNKNOWN_PROTECTED_" + protectedId);
  return `SELECT COUNT(*) AS n FROM ${p.table} WHERE ${p.predicate}`;
}
