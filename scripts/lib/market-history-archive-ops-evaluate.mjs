/**
 * Classify archive outcomes without hiding lease contention as schema drift.
 * A held lease is not archive progress, even if the endpoint reports ok:true.
 */
export function archiveProgressFailures(archive, { writes, expectedColumns = 50 } = {}) {
  const failures = [];
  const reason = archive?.reason || null;
  if (archive?.ok !== true) failures.push(reason || "ARCHIVE_NOT_OK");
  if (writes && reason === "ARCHIVE_LEASE_HELD") failures.push("ARCHIVE_LEASE_HELD");
  if (writes && Number(archive?.archived || 0) === 0 && archive?.moreRemaining === true) {
    failures.push("ARCHIVE_NO_PROGRESS_BACKLOG_REMAINS");
  }
  // A lease response has no row schema to check. Never call that a schema regression.
  if (reason !== "ARCHIVE_LEASE_HELD" && Number(archive?.columnCount) !== expectedColumns) {
    failures.push(`COLUMN_COUNT_${archive?.columnCount}_EXPECTED_${expectedColumns}`);
  }
  return [...new Set(failures)];
}
