#!/usr/bin/env node
/**
 * Re-link archived PinnOdds snapshots with current identity matchers.
 * Never calls the paid PinnOdds provider API.
 *
 * Usage:
 *   BASE=https://fbis-myz.pages.dev HARVEST_SECRET=... \
 *     node scripts/rematch-pinnodds-archived.mjs [--sport-id=2] [--dry-run]
 *     node scripts/rematch-pinnodds-archived.mjs \
 *       --snapshot-id=run-38448188039-1-board-2-prematch \
 *       --snapshot-id=run-38448188039-1-board-2-live
 *     # NBA opening slate: force rematch even when slug IDs already matched
 *     node scripts/rematch-pinnodds-archived.mjs --sport-id=3 --include-matched --post-capture-fixtures
 *
 * Known tennis unmatched archives (2026-10-13, matchedRows=0):
 *   --snapshot-id=run-38448188039-1-board-2-prematch
 *   --snapshot-id=run-38448188039-1-board-2-live
 */
const base = process.env.BASE || "https://fbis-myz.pages.dev";
const secret = process.env.HARVEST_SECRET;
if (!secret) throw new Error("EXISTING_COLLECTION_AUTH_REQUIRED");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const postCaptureFixtures = args.has("--post-capture-fixtures");
const includeMatched = args.has("--include-matched");
const sportFilter = [...args].find((a) => a.startsWith("--sport-id="));
const sportId = sportFilter ? Number(sportFilter.split("=")[1]) : null;
const explicitIds = [...args].filter((a) => a.startsWith("--snapshot-id=")).map((a) => a.split("=")[1]).filter(Boolean);

async function call(body) {
  const res = await fetch(`${base}/api/pinnodds-ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harvest-secret": secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const result = await res.json();
  if (!res.ok || result.ok !== true) throw new Error(result.error || `HTTP_${res.status}`);
  return result;
}

const statusRes = await fetch(`${base}/api/pinnodds-status`, {
  headers: { "cache-control": "no-store" },
  signal: AbortSignal.timeout(30000),
});
if (!statusRes.ok) throw new Error(`PINNODDS_STATUS_HTTP_${statusRes.status}`);
const status = await statusRes.json();
const boards = explicitIds.length
  ? explicitIds.map((snapshotId) => ({ snapshotId, kind: "board" }))
  : (status.results || []).filter((r) => {
    if (r.kind !== "board") return false;
    if (sportId != null && Number(r.sportId) !== sportId) return false;
    if (!r.snapshotId) return false;
    // Default: only boards that normalized but failed identity match.
    // --include-matched: rematch already-linked boards (e.g. NBA slug → ESPN).
    if (includeMatched) return Number(r.normalizedRows || 0) > 0 || Number(r.matchedRows || 0) > 0;
    return Number(r.normalizedRows || 0) > 0 && Number(r.matchedRows || 0) === 0;
  });

if (!boards.length) {
  console.log(JSON.stringify({
    ok: true,
    paidProviderCalls: 0,
    dryRun,
    includeMatched,
    candidates: 0,
    note: includeMatched
      ? "No archived boards with snapshotId for sport filter. Pass --snapshot-id=... explicitly."
      : "No unmatched archived boards with snapshotId. Pass --snapshot-id=... or --include-matched.",
    results: [],
    errors: [],
  }, null, 2));
  process.exit(0);
}

const summary = { ok: true, paidProviderCalls: 0, dryRun, candidates: boards.length, results: [], errors: [] };
for (const board of boards) {
  if (dryRun) {
    summary.results.push({ ...board, dryRun: true });
    continue;
  }
  try {
    // Batched rematch: prepare → consume pages → finalize (avoids Pages timeouts).
    const prepared = await call({
      operation: "rematch",
      phase: "prepare",
      snapshotId: board.snapshotId,
      postCaptureFixtures,
    });
    let inserted = 0;
    for (let batchIndex = 0; batchIndex < (prepared.batches || 0); batchIndex++) {
      const consumed = await call({
        operation: "rematch",
        phase: "consume",
        snapshotId: board.snapshotId,
        batchIndex,
      });
      inserted += Number(consumed.inserted || 0);
    }
    const finalized = await call({
      operation: "rematch",
      phase: "finalize",
      snapshotId: board.snapshotId,
    });
    summary.results.push({
      ...finalized,
      inserted,
      postCaptureFixtures,
      fixtureAsOf: prepared.fixtureAsOf || null,
      prepareMatchedRows: prepared.matchedRows || 0,
    });
  } catch (error) {
    summary.ok = false;
    summary.errors.push({
      snapshotId: board.snapshotId,
      sportId: board.sportId,
      feed: board.feed,
      error: String(error.message || error),
    });
  }
}
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
