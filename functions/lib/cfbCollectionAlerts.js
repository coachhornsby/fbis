/**
 * Independent CFB collection + model-input monitoring.
 * Detects missed windows without relying solely on the scheduled job's self-report.
 */

import { DATASET_STATUS } from "./cfbSdvSourceRegistry.js";
import {
  buildCollectionManifest,
  listRequiredDatasets,
  WEEKLY_COLLECTION_SCHEDULE,
} from "./cfbWeeklyCollection.js";

export const ALERTS_VERSION = "cfb-collection-alerts-v1";

export const ALERT_CODES = Object.freeze({
  MISSED_SCHEDULED_COLLECTION: "missed_scheduled_collection",
  LATE_PROVIDER_PUBLICATION: "late_provider_publication",
  HTTP_OK_EMPTY: "empty_successful_api_response",
  MISSING_TEAMS: "missing_teams",
  COVERAGE_DROP: "unexpected_coverage_reduction",
  WRONG_THROUGH_WEEK: "incorrect_through_week",
  SCHEMA_DRIFT: "source_schema_drift",
  QUOTA_BLOCK: "quota_blocks",
  ARCHIVE_FAILED: "failed_raw_archival",
  MISSING_D1_FEATURES: "missing_d1_feature_rows",
  IDENTITY_FAILURE: "canonical_team_identity_failure",
  PAGE_MODEL_GAP: "team_page_data_absent_from_model_inputs",
  EXCESSIVE_PRIOR: "excessive_stale_prior_influence",
  FREEZE_FAILED: "failed_projection_freeze",
  UNSETTLED_FINALS: "unsettled_verified_finals",
  BOARD_PROJECTION_MISMATCH: "board_vs_saved_projection_mismatch",
});

/**
 * Build a structured alert.
 */
export function makeAlert({
  code,
  severity = "error",
  source = null,
  season = null,
  week = null,
  teams = [],
  games = [],
  lastSuccessfulReceipt = null,
  reason = null,
  repairProcedure = null,
  resolutionStatus = "open",
} = {}) {
  return {
    version: ALERTS_VERSION,
    code,
    severity,
    source,
    season,
    week,
    teams,
    games,
    lastSuccessfulReceipt,
    reason,
    repairProcedure:
      repairProcedure ||
      defaultRepair(code),
    resolutionStatus,
    detectedAt: new Date().toISOString(),
  };
}

function defaultRepair(code) {
  switch (code) {
    case ALERT_CODES.QUOTA_BLOCK:
      return "Wait for shared CFBD/CBBD allowance replenishment; ack via cfb-quota-replenish-ack; retry budgeted endpoints only";
    case ALERT_CODES.HTTP_OK_EMPTY:
      return "Do not mark complete; retry after provider publication window; preserve last verified snapshot";
    case ALERT_CODES.MISSED_SCHEDULED_COLLECTION:
      return "Run idempotent collection for the missing dataset with content-hash guard; update manifest";
    case ALERT_CODES.EXCESSIVE_PRIOR:
      return "Verify gamesPlayed from schedule finals; ensure deep-feed blend uses n>0; do not silently zero current PPA";
    case ALERT_CODES.MISSING_D1_FEATURES:
      return "Re-run cfb-current-refresh; confirm team_feature_snapshots rows for season with ppaOff+gamesPlayed";
    case ALERT_CODES.BOARD_PROJECTION_MISMATCH:
      return "Compare frozen projection vector hash to board payload; re-freeze if board is stale";
    default:
      return "Investigate receipt + schema + identity; retry with quota guard; escalate if recurrent";
  }
}

/**
 * Reconcile expected required datasets vs verified receipts for a season/week.
 * Independent of the job runner — call from health / Data Ops.
 */
export function reconcileCollectionHealth({
  season,
  week,
  evidenceByDataset = {},
  allowanceBlocked = false,
  now = new Date(),
  expectedTeamFloor = 130,
  priorCoverageByDataset = {},
  expectedThroughWeek = null,
  d1FeatureTeamCount = null,
  pageModelGapTeams = [],
  priorWeightAlerts = [],
  freezeFailures = [],
  unsettledFinals = 0,
  boardMismatches = [],
} = {}) {
  const manifest = buildCollectionManifest({
    season,
    week,
    evidenceByDataset,
    allowanceBlocked,
    now,
  });
  const alerts = [...(manifest.alerts || [])];

  for (const id of listRequiredDatasets()) {
    const ev = evidenceByDataset[id];
    const entry = manifest.datasets.find((d) => d.datasetId === id);
    if (!ev && entry?.status === DATASET_STATUS.NOT_YET_DUE) {
      // Only alert overdue if past Chicago window heuristic (Mon 12:00 for morning refresh)
      const overdue = isPastCollectionWindow(id, now);
      if (overdue) {
        alerts.push(
          makeAlert({
            code: ALERT_CODES.MISSED_SCHEDULED_COLLECTION,
            source: id,
            season,
            week,
            reason: `No verified receipt for required dataset ${id} after expected window`,
          })
        );
      }
    }
    if (ev?.httpOk && !(ev.rowCount > 0)) {
      alerts.push(
        makeAlert({
          code: ALERT_CODES.HTTP_OK_EMPTY,
          source: id,
          season,
          week,
          lastSuccessfulReceipt: ev.collectedAt || null,
          reason: "HTTP success with zero usable rows",
        })
      );
    }
    if (ev?.teamCoverage != null && ev.teamCoverage < expectedTeamFloor * 0.85) {
      alerts.push(
        makeAlert({
          code: ALERT_CODES.MISSING_TEAMS,
          severity: "warning",
          source: id,
          season,
          week,
          reason: `Team coverage ${ev.teamCoverage} below floor ${expectedTeamFloor}`,
        })
      );
    }
    const priorCov = priorCoverageByDataset[id];
    if (
      priorCov != null &&
      ev?.teamCoverage != null &&
      ev.teamCoverage < priorCov * 0.9
    ) {
      alerts.push(
        makeAlert({
          code: ALERT_CODES.COVERAGE_DROP,
          severity: "warning",
          source: id,
          season,
          week,
          reason: `Coverage dropped from ${priorCov} to ${ev.teamCoverage}`,
        })
      );
    }
    if (
      expectedThroughWeek != null &&
      ev?.throughWeek != null &&
      Number(ev.throughWeek) !== Number(expectedThroughWeek)
    ) {
      alerts.push(
        makeAlert({
          code: ALERT_CODES.WRONG_THROUGH_WEEK,
          source: id,
          season,
          week,
          reason: `throughWeek=${ev.throughWeek} expected=${expectedThroughWeek}`,
        })
      );
    }
    if (ev?.schemaOk === false) {
      alerts.push(
        makeAlert({
          code: ALERT_CODES.SCHEMA_DRIFT,
          source: id,
          season,
          week,
          reason: "Schema validation failed",
        })
      );
    }
  }

  if (allowanceBlocked) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.QUOTA_BLOCK,
        source: "cfbd",
        season,
        week,
        reason: "Shared CFBD/CBBD allowance blocked",
      })
    );
  }

  if (d1FeatureTeamCount != null && d1FeatureTeamCount < expectedTeamFloor * 0.85) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.MISSING_D1_FEATURES,
        source: "team_feature_snapshots",
        season,
        week,
        reason: `Only ${d1FeatureTeamCount} D1 feature rows`,
      })
    );
  }

  for (const t of pageModelGapTeams || []) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.PAGE_MODEL_GAP,
        severity: "warning",
        source: "utilization",
        season,
        week,
        teams: [t.team || t],
        reason: t.reason || "Page-visible field absent from model inputs",
      })
    );
  }

  for (const p of priorWeightAlerts || []) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.EXCESSIVE_PRIOR,
        severity: "warning",
        source: "prior_decay",
        season,
        week,
        teams: p.teams || [],
        games: p.games || [],
        reason: p.reason || "Prior weight near 100% despite current-season evidence",
      })
    );
  }

  for (const f of freezeFailures || []) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.FREEZE_FAILED,
        source: "cfb-pregame-freeze",
        season,
        week,
        games: [f.gameId || f].filter(Boolean),
        reason: f.reason || "Pregame freeze failed",
      })
    );
  }

  if (unsettledFinals > 0) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.UNSETTLED_FINALS,
        severity: "warning",
        source: "settlement",
        season,
        week,
        reason: `${unsettledFinals} verified finals unsettled against frozen projections`,
      })
    );
  }

  for (const m of boardMismatches || []) {
    alerts.push(
      makeAlert({
        code: ALERT_CODES.BOARD_PROJECTION_MISMATCH,
        source: "board",
        season,
        week,
        games: [m.gameId].filter(Boolean),
        reason: m.reason || "Board display differs from saved model projection",
      })
    );
  }

  const critical = alerts.filter((a) => a.severity === "error");
  return {
    version: ALERTS_VERSION,
    season,
    week,
    manifest,
    schedule: WEEKLY_COLLECTION_SCHEDULE,
    alerts,
    criticalCount: critical.length,
    healthy: critical.length === 0,
  };
}

/** Rough Chicago overdue check for morning refresh datasets. */
export function isPastCollectionWindow(datasetId, now = new Date()) {
  const chicago = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const weekday = chicago.find((p) => p.type === "weekday")?.value;
  const hour = Number(chicago.find((p) => p.type === "hour")?.value);
  // Mon–Fri after 12:00 CT → morning refresh should have completed
  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && hour >= 12) {
    return /cfbd-ppa|cfbd-stats-season|cfbd-ratings|cfbd-talent/i.test(datasetId);
  }
  // Sunday after 14:00 → postgame should have run
  if (weekday === "Sun" && hour >= 14) {
    return /cfbd-games/i.test(datasetId);
  }
  return false;
}
