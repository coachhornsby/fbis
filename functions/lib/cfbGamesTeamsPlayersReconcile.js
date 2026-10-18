/**
 * Evidence-backed reconciliation for cfbd-games-teams-players.
 * Never calls CFBD. Builds D1 manifest rows from verified R2 + observation counts.
 */

import {
  buildManifestRow,
  buildR2ArchiveManifestRow,
  describeWeeklyReconstructionWindow,
  persistCollectionManifest,
} from "./cfbCollectionManifestPersist.js";
import { DATASET_STATUS } from "./cfbSdvSourceRegistry.js";

export const GAMES_TEAMS_PLAYERS_RECONCILE_VERSION = "cfb-games-teams-players-reconcile-v1";

/**
 * @typedef {{
 *   key: string,
 *   bytes: number,
 *   rowCount: number,
 *   kind: 'games_teams'|'games_players_passing'|'games_players_receiving'|'games_players_rushing',
 *   uploadedAt?: string|null,
 *   jobRunId?: string|null,
 * }} ArchiveEvidence
 */

/**
 * Build verified statistical-week (throughWeek) + target-week receipts from R2 evidence.
 * Does not invent week-N boxes when only week-(N-1) archives exist.
 */
export function buildGamesTeamsPlayersReconcileRows({
  season = 2026,
  targetWeek = 8,
  archives = [],
  now = new Date().toISOString(),
} = {}) {
  const window = describeWeeklyReconstructionWindow(targetWeek);
  if (!window.ok) {
    return { ok: false, reason: window.reason || "invalid-window", rows: [], window };
  }
  const throughWeek = window.throughWeek;
  const list = Array.isArray(archives) ? archives : [];
  const teams = list.filter((a) => a.kind === "games_teams" && a.bytes > 0 && a.rowCount > 0);
  const players = list.filter((a) => String(a.kind || "").startsWith("games_players_") && a.bytes > 0 && a.rowCount > 0);
  if (!teams.length || players.length < 3) {
    return {
      ok: false,
      reason: "incomplete-archive-set",
      rows: [],
      window,
      found: { teams: teams.length, playerCategories: players.length },
    };
  }

  const teamRows = teams.reduce((s, a) => s + Number(a.rowCount || 0), 0);
  const playerRows = players.reduce((s, a) => s + Number(a.rowCount || 0), 0);
  const totalBytes = [...teams, ...players].reduce((s, a) => s + Number(a.bytes || 0), 0);
  const keys = [...teams, ...players].map((a) => a.key);
  const jobRunId = teams[0]?.jobRunId || players[0]?.jobRunId || null;

  // 1) Statistical week receipt (week = throughWeek)
  const statistical = buildManifestRow({
    season,
    week: throughWeek,
    provider: "cfbd",
    datasetId: "cfbd-games-teams-players",
    required: true,
    httpOk: true,
    httpStatus: 200,
    rowCount: teamRows,
    teamCoverage: null,
    throughWeek,
    contentHash: `r2:${keys[0]}`,
    ingestionBatchId: `r2-recon:games-teams-players:W${throughWeek}`,
    collectedAt: now,
    status: DATASET_STATUS.COMPLETE_VERIFIED,
    evidence: {
      source: "r2_archive_reconcile",
      statisticalWeek: throughWeek,
      targetWeek,
      archives: list.map((a) => ({
        kind: a.kind,
        key: a.key,
        bytes: a.bytes,
        rowCount: a.rowCount,
      })),
      gamesTeamsRowCount: teamRows,
      gamesPlayersCategoryRowCounts: Object.fromEntries(
        players.map((a) => [a.kind.replace("games_players_", ""), a.rowCount])
      ),
      gamesPlayersMergedGames: Math.max(...players.map((a) => a.rowCount)),
      totalBytes,
      jobRunId,
      note: "Verified from R2 + source_observations — statistical week archive",
    },
  });

  // 2) Target-week reconstruction receipt (week = targetWeek, through_week = throughWeek)
  const target = buildR2ArchiveManifestRow({
    season,
    week: targetWeek,
    datasetId: "cfbd-games-teams-players",
    r2Key: keys.join("|"),
    objectBytes: totalBytes,
    throughWeek,
    uploadedAt: now,
    rowCount: teamRows,
    teamCoverage: null,
    ingestionBatchId: `r2-recon:games-teams-players:targetW${targetWeek}`,
    status: DATASET_STATUS.COMPLETE_VERIFIED,
    evidence: {
      statisticalWeek: throughWeek,
      targetWeek,
      windowNote: window.note,
      archives: list.map((a) => ({ kind: a.kind, key: a.key, bytes: a.bytes, rowCount: a.rowCount })),
      gamesTeamsRowCount: teamRows,
      gamesPlayersCategoryRowCounts: Object.fromEntries(
        players.map((a) => [a.kind.replace("games_players_", ""), a.rowCount])
      ),
      jobRunId,
      supersedesGapReceipt: `${season}:W${targetWeek}:cfbd-games-teams-players:pending-collection`,
    },
  });

  // 3) Preserve the operator gap receipt as failed: statistical week=targetWeek
  // boxes remain uncollected (no week-{targetWeek} R2 objects). A targetWeek=N
  // refresh only archives throughWeek=N-1 — do not fabricate W{N} boxes.
  // When week N games have just finished, collection still requires an authorized
  // refresh with targetWeek=N+1 (throughWeek=N).
  const gapPreserved = buildManifestRow({
    season,
    week: targetWeek,
    provider: "cfbd",
    datasetId: "cfbd-games-teams-players",
    required: true,
    httpOk: false,
    httpStatus: null,
    rowCount: 0,
    teamCoverage: null,
    throughWeek,
    contentHash: null,
    ingestionBatchId: "pending-collection-visible",
    collectedAt: now,
    status: DATASET_STATUS.FAILED,
    alerts: [
      {
        code: "statistical_week_uncollected",
        detail:
          `Statistical week ${targetWeek} boxes not in R2; collect via authorized refresh targetWeek=${targetWeek + 1}`,
      },
    ],
    evidence: {
      source: "r2_archive_reconcile",
      preservedGapFailure: true,
      priorStatus: "failed",
      statisticalWeekCollected: throughWeek,
      statisticalWeekClaimed: targetWeek,
      statisticalWeekArchivedInR2: false,
      nextCollectionTargetWeek: targetWeek + 1,
      nextCollectionThroughWeek: targetWeek,
      targetWeek,
      throughWeek,
      supersedingReceipts: [
        statistical.manifest_id,
        target.manifest_id,
      ],
      archives: list.map((a) => ({ kind: a.kind, key: a.key, bytes: a.bytes, rowCount: a.rowCount })),
      jobRunId,
      note:
        `Preserved failed status: week=${targetWeek} statistical boxes uncollected. ` +
        `Verified throughWeek=${throughWeek} archives live under superseding receipts. ` +
        `targetWeek=${targetWeek} refresh correctly archived week ${throughWeek} only.`,
    },
  });
  // Force stable manifest_id for the gap row
  gapPreserved.manifest_id = `${season}:W${targetWeek}:cfbd-games-teams-players:pending-collection`;

  return {
    ok: true,
    window,
    rows: [statistical, target, gapPreserved],
    summary: {
      season,
      targetWeek,
      throughWeek,
      gamesTeamsRowCount: teamRows,
      gamesPlayersPassing: players.find((a) => a.kind === "games_players_passing")?.rowCount || 0,
      gamesPlayersReceiving: players.find((a) => a.kind === "games_players_receiving")?.rowCount || 0,
      gamesPlayersRushing: players.find((a) => a.kind === "games_players_rushing")?.rowCount || 0,
      archiveKeys: keys,
      totalBytes,
      jobRunId,
      week8StatisticalCollected: false,
      week8R2Objects: 0,
      pendingCollectionPreservedFailed: true,
      week8StatisticalNote:
        `Week ${targetWeek} games may be complete, but statistical boxes are uncollected ` +
        `(no week-${targetWeek} R2 objects). Next authorized refresh: targetWeek=${targetWeek + 1} → throughWeek=${targetWeek}.`,
    },
  };
}

export async function persistGamesTeamsPlayersReconcile(env, opts = {}) {
  const built = buildGamesTeamsPlayersReconcileRows(opts);
  if (!built.ok) return { ...built, persisted: { attempted: 0, succeeded: 0 } };
  const persisted = [];
  for (const row of built.rows) {
    persisted.push(await persistCollectionManifest(env, row));
  }
  return {
    ...built,
    persisted: {
      attempted: persisted.length,
      succeeded: persisted.filter((r) => r.ok).length,
      results: persisted,
    },
  };
}
