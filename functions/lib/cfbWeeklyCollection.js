/**
 * Governed weekly CFB collection schedule, manifests, and monitoring.
 * HTTP 200 alone never marks a dataset complete — validate rows, coverage, schema, through-week.
 */

import { DATASET_STATUS } from "./cfbSdvSourceRegistry.js";
import { CFBD_ENDPOINT_REGISTRY } from "./cfbCfbdSourceRegistry.js";
import { SDV_SOURCE_REGISTRY } from "./cfbSdvSourceRegistry.js";

export const WEEKLY_COLLECTION_VERSION = "cfb-weekly-collection-v1";

/** Expected FBS team coverage floor for season-level team endpoints. */
export const EXPECTED_FBS_TEAM_FLOOR = 130;

/**
 * Canonical weekly schedule accounting for publication windows, CFB game days,
 * delayed corrections, CORE availability, and shared CFBD quota.
 */
export const WEEKLY_COLLECTION_SCHEDULE = Object.freeze([
  {
    id: "cfbd-postgame-sunday",
    provider: "cfbd",
    datasets: ["cfbd-games", "cfbd-games-teams-players"],
    chicagoWindow: "Sun 06:00–12:00",
    afterPublication: "Most Saturday finals settled; allow unfinished → retry Mon",
    retries: ["Mon 08:00", "Tue 08:00"],
    quotaWeight: "high",
    required: true,
  },
  {
    id: "cfbd-morning-refresh",
    provider: "cfbd",
    datasets: [
      "cfbd-ppa-teams",
      "cfbd-stats-season-advanced",
      "cfbd-ratings-sp",
      "cfbd-ratings-fpi",
      "cfbd-ratings-srs",
      "cfbd-ratings-elo",
      "cfbd-ratings-core",
      "cfbd-talent-returning",
    ],
    chicagoWindow: "Mon–Fri 07:00–09:00 (cfb-current-refresh)",
    afterPublication: "After CFBD overnight updates; CORE throughWeek ≤ targetWeek−1",
    retries: ["same-day +4h if partial", "next morning"],
    quotaWeight: "high",
    required: true,
  },
  {
    id: "cfbd-weekly-reconstruction",
    provider: "cfbd",
    datasets: ["cfbd-ppa-games", "cfbd-stats-game-advanced"],
    chicagoWindow: "Mon 09:00–12:00 (budgeted week = targetWeek−1)",
    afterPublication: "Prior completed week game-level stats",
    retries: ["Tue if blocked_by_provider_allowance"],
    quotaWeight: "medium",
    required: true,
  },
  {
    id: "cfbd-lines-eval",
    provider: "cfbd",
    datasets: ["cfbd-lines"],
    chicagoWindow: "Game-day / pregame freeze",
    afterPublication: "Evaluation only — never enters independent score",
    retries: [],
    quotaWeight: "low",
    required: false,
    evaluationOnly: true,
  },
  {
    id: "sdv-intelligence-cache",
    provider: "sdv",
    datasets: ["sdv-team-summaries-2026", "sdv-schedules-2026"],
    chicagoWindow: "On demand + forward-evidence cron (30m cache)",
    afterPublication: "Public release CSV; lag vs finals expected",
    retries: ["cache TTL refresh"],
    quotaWeight: "none",
    required: false,
    note: "Display/research — not champion",
  },
  {
    id: "sdv-pit-fallback",
    provider: "sdv",
    datasets: ["sdv-pit-fallback"],
    chicagoWindow: "During cfb-pregame-freeze when CFBD deep-feed integrity fails",
    afterPublication: "Conditional research path only",
    retries: [],
    quotaWeight: "none",
    required: false,
  },
  {
    id: "core-weekly-pit-archive",
    provider: "cfbd",
    datasets: ["cfbd-ratings-core"],
    chicagoWindow: "With cfb-current-refresh; archive every weekly PIT release",
    afterPublication: "Persist offense/defense/year/throughWeek/collectionTime",
    retries: ["next refresh if rowCount < floor"],
    quotaWeight: "included_in_morning",
    required: true,
    researchOnly: true,
  },
]);

export function listRequiredDatasets() {
  return WEEKLY_COLLECTION_SCHEDULE.filter((s) => s.required)
    .flatMap((s) => s.datasets)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Build a collection manifest for season/week. Status starts from schedule + optional evidence.
 */
export function buildCollectionManifest({
  season,
  week,
  now = new Date(),
  evidenceByDataset = {},
  allowanceBlocked = false,
} = {}) {
  const required = listRequiredDatasets();
  const entries = [];

  for (const schedule of WEEKLY_COLLECTION_SCHEDULE) {
    for (const datasetId of schedule.datasets) {
      const evidence = evidenceByDataset[datasetId] || null;
      const status = deriveDatasetStatus({
        schedule,
        evidence,
        allowanceBlocked,
        now,
      });
      entries.push({
        datasetId,
        provider: schedule.provider,
        scheduleId: schedule.id,
        season: Number(season),
        week: Number(week),
        required: Boolean(schedule.required),
        evaluationOnly: Boolean(schedule.evaluationOnly),
        researchOnly: Boolean(schedule.researchOnly),
        chicagoWindow: schedule.chicagoWindow,
        status,
        evidence: evidence
          ? {
              httpOk: evidence.httpOk === true,
              rowCount: evidence.rowCount ?? null,
              teamCoverage: evidence.teamCoverage ?? null,
              throughWeek: evidence.throughWeek ?? null,
              schemaOk: evidence.schemaOk !== false,
              collectedAt: evidence.collectedAt || null,
              contentHash: evidence.contentHash || null,
              ingestionBatchId: evidence.ingestionBatchId || null,
            }
          : null,
        verifiedComplete: status === DATASET_STATUS.COMPLETE_VERIFIED,
      });
    }
  }

  // Deduplicate by datasetId keeping highest-priority schedule entry
  const byId = new Map();
  for (const e of entries) {
    if (!byId.has(e.datasetId)) byId.set(e.datasetId, e);
  }
  const datasets = [...byId.values()];

  const alerts = detectCollectionAlerts({ datasets, season, week, required });

  return {
    version: WEEKLY_COLLECTION_VERSION,
    season: Number(season),
    week: Number(week),
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    datasets,
    requiredCount: required.length,
    verifiedRequired: datasets.filter((d) => d.required && d.verifiedComplete).length,
    alerts,
    complete: alerts.every((a) => a.severity !== "error") &&
      datasets.filter((d) => d.required).every((d) => d.verifiedComplete),
  };
}

export function deriveDatasetStatus({ schedule, evidence, allowanceBlocked, now }) {
  if (allowanceBlocked && schedule.provider === "cfbd") {
    return DATASET_STATUS.BLOCKED_ALLOWANCE;
  }
  if (!evidence) {
    return DATASET_STATUS.NOT_YET_DUE;
  }
  if (evidence.collecting) return DATASET_STATUS.COLLECTING;
  if (evidence.waitingPublication) return DATASET_STATUS.WAITING_PUBLICATION;
  if (evidence.failed) return DATASET_STATUS.FAILED;
  if (evidence.stale) return DATASET_STATUS.STALE;

  // HTTP 200 alone is insufficient
  if (evidence.httpOk && !(evidence.rowCount > 0)) {
    return DATASET_STATUS.FAILED;
  }
  if (evidence.httpOk && evidence.schemaOk === false) {
    return DATASET_STATUS.FAILED;
  }

  const needsTeamFloor =
    schedule.provider === "cfbd" &&
    /ppa-teams|stats-season|ratings-|talent/i.test(String(schedule.datasets?.join(",") || evidence.datasetId || ""));

  const teamCoverage = Number(evidence.teamCoverage ?? evidence.rowCount ?? 0);
  if (evidence.httpOk && evidence.rowCount > 0 && evidence.schemaOk !== false) {
    if (needsTeamFloor && teamCoverage < EXPECTED_FBS_TEAM_FLOOR * 0.85) {
      return DATASET_STATUS.PARTIAL;
    }
    if (evidence.partial) return DATASET_STATUS.PARTIAL;
    return DATASET_STATUS.COMPLETE_VERIFIED;
  }

  if (evidence.rowCount > 0 && evidence.partial) return DATASET_STATUS.PARTIAL;
  void now;
  return DATASET_STATUS.NOT_YET_DUE;
}

/**
 * Validate collection evidence beyond HTTP status.
 */
export function validateCollectionEvidence({
  httpStatus = null,
  rows = [],
  expectedFields = [],
  throughWeek = null,
  expectedThroughWeek = null,
  teamIds = null,
  expectedTeamFloor = EXPECTED_FBS_TEAM_FLOOR,
} = {}) {
  const httpOk = httpStatus === 200;
  const rowCount = Array.isArray(rows) ? rows.length : Number(rows) || 0;
  const sample = Array.isArray(rows) && rows[0] ? rows[0] : null;
  let schemaOk = true;
  const missingFields = [];
  if (expectedFields.length && sample) {
    for (const f of expectedFields) {
      const top = f.split(".")[0];
      if (!(top in sample) && sample[top] === undefined) {
        // nested path soft-check
        if (!f.includes(".")) missingFields.push(f);
      }
    }
    schemaOk = missingFields.length === 0;
  }
  const teamCoverage = Array.isArray(teamIds)
    ? new Set(teamIds).size
    : rowCount;
  const throughWeekOk =
    expectedThroughWeek == null ||
    throughWeek == null ||
    Number(throughWeek) === Number(expectedThroughWeek);

  const usable =
    httpOk &&
    rowCount > 0 &&
    schemaOk &&
    throughWeekOk &&
    teamCoverage >= Math.floor(expectedTeamFloor * 0.5);

  return {
    httpOk,
    rowCount,
    teamCoverage,
    schemaOk,
    missingFields,
    throughWeek: throughWeek ?? null,
    throughWeekOk,
    usable,
    reason: !httpOk
      ? "http_not_ok"
      : rowCount <= 0
        ? "empty_payload"
        : !schemaOk
          ? "schema_mismatch"
          : !throughWeekOk
            ? "through_week_mismatch"
            : !usable
              ? "coverage_below_floor"
              : "verified",
  };
}

export function detectCollectionAlerts({ datasets = [], season, week, required = [] } = {}) {
  const alerts = [];
  for (const d of datasets) {
    if (d.required && d.status === DATASET_STATUS.FAILED) {
      alerts.push({
        severity: "error",
        code: "required_source_failed",
        datasetId: d.datasetId,
        message: `Required ${d.datasetId} failed for ${season} W${week}`,
      });
    }
    if (d.required && d.status === DATASET_STATUS.STALE) {
      alerts.push({
        severity: "error",
        code: "required_source_stale",
        datasetId: d.datasetId,
        message: `Required ${d.datasetId} is stale`,
      });
    }
    if (d.required && d.status === DATASET_STATUS.PARTIAL) {
      alerts.push({
        severity: "warning",
        code: "partial_coverage",
        datasetId: d.datasetId,
        message: `Partial team coverage for ${d.datasetId}`,
      });
    }
    if (d.status === DATASET_STATUS.BLOCKED_ALLOWANCE) {
      alerts.push({
        severity: "error",
        code: "blocked_by_provider_allowance",
        datasetId: d.datasetId,
        message: "CFBD/CBBD shared allowance blocked further collection",
      });
    }
    if (d.evidence?.httpOk && !(d.evidence.rowCount > 0)) {
      alerts.push({
        severity: "error",
        code: "http_ok_empty_payload",
        datasetId: d.datasetId,
        message: "HTTP success produced no usable rows",
      });
    }
    if (d.evidence?.schemaOk === false) {
      alerts.push({
        severity: "error",
        code: "schema_change",
        datasetId: d.datasetId,
        message: "Schema validation failed — parsing may be broken",
      });
    }
  }
  for (const id of required) {
    const hit = datasets.find((d) => d.datasetId === id);
    if (!hit) {
      alerts.push({
        severity: "error",
        code: "missing_manifest_entry",
        datasetId: id,
        message: `Required dataset ${id} missing from manifest`,
      });
    }
  }
  return alerts;
}

/**
 * Idempotent retry guard: same batch key must not duplicate durable rows.
 */
export function retryGuard({ priorBatchId, newBatchId, priorContentHash, newContentHash } = {}) {
  if (priorBatchId && newBatchId && priorBatchId === newBatchId) {
    return { allow: false, reason: "duplicate_batch_id" };
  }
  if (priorContentHash && newContentHash && priorContentHash === newContentHash) {
    return { allow: true, reason: "idempotent_same_hash", skipWrite: true };
  }
  return { allow: true, reason: "new_or_changed", skipWrite: false };
}

/** Existing vs required schedule comparison for ops report. */
export function compareExistingVsRequired() {
  const required = listRequiredDatasets();
  const cfbdKnown = new Set(CFBD_ENDPOINT_REGISTRY.map((e) => e.id));
  const sdvKnown = new Set(SDV_SOURCE_REGISTRY.map((d) => d.id));
  const collectedCfbd = CFBD_ENDPOINT_REGISTRY.filter((e) => e.collectedCurrently).map((e) => e.id);
  const collectedSdv = SDV_SOURCE_REGISTRY.filter((d) => d.collectedCurrently).map((d) => d.id);

  const missingRequired = required.filter(
    (id) => !collectedCfbd.includes(id) && !collectedSdv.includes(id)
  );

  return {
    version: WEEKLY_COLLECTION_VERSION,
    schedule: WEEKLY_COLLECTION_SCHEDULE,
    required,
    collectedCurrently: { cfbd: collectedCfbd, sdv: collectedSdv },
    registryCoverage: {
      cfbdEndpoints: cfbdKnown.size,
      sdvDatasets: sdvKnown.size,
    },
    missingRequiredCollections: missingRequired,
    gaps: [
      "CFBD GraphQL has zero production query documents",
      "SDV team directory / rosters not collected on live path",
      "Elo catalog vs prior loader mismatch (refresh persists; prior loader may pass elo:[])",
    ],
  };
}

/**
 * Practical weekly operating report: expected → arrived → stored → consumed.
 */
export function buildWeeklyOperatingReport({
  season,
  week,
  manifest = null,
  modelConsumption = null,
} = {}) {
  const m =
    manifest ||
    buildCollectionManifest({
      season,
      week,
      evidenceByDataset: {},
    });
  return {
    version: WEEKLY_COLLECTION_VERSION,
    season: Number(season),
    week: Number(week),
    supposedToArrive: m.datasets.map((d) => ({
      datasetId: d.datasetId,
      provider: d.provider,
      required: d.required,
      window: d.chicagoWindow,
    })),
    actuallyArrived: m.datasets.map((d) => ({
      datasetId: d.datasetId,
      status: d.status,
      rowCount: d.evidence?.rowCount ?? null,
      teamCoverage: d.evidence?.teamCoverage ?? null,
      collectedAt: d.evidence?.collectedAt ?? null,
    })),
    stored: m.datasets.map((d) => ({
      datasetId: d.datasetId,
      contentHash: d.evidence?.contentHash ?? null,
      ingestionBatchId: d.evidence?.ingestionBatchId ?? null,
      verifiedComplete: d.verifiedComplete,
    })),
    modelConsumed: modelConsumption || {
      champion: ["ppaOff", "ppaDef", "gamesPlayed", "priorOff", "priorDef"],
      coreResearch: ["core", "coreOffense", "coreDefense", "coreThroughWeek"],
      note: "Pass actual scoring provenance from buildScoringProvenance for per-matchup proof",
    },
    alerts: m.alerts,
    complete: m.complete,
  };
}
