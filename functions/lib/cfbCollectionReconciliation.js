/**
 * Reconcile required / conditionally-due CFB datasets.
 * Classifies: verified | collected_no_receipt | not_due | collection_failed | conditional_skipped.
 * Never fabricates historical receipts.
 */

import { listRequiredDatasets, WEEKLY_COLLECTION_SCHEDULE, EXPECTED_FBS_TEAM_FLOOR } from "./cfbWeeklyCollection.js";
import { SDV_SOURCE_REGISTRY } from "./cfbSdvSourceRegistry.js";
import { CFBD_ENDPOINT_REGISTRY } from "./cfbCfbdSourceRegistry.js";

export const COLLECTION_RECON_VERSION = "cfb-collection-reconciliation-v1";

export const DUE_CLASS = Object.freeze({
  VERIFIED: "verified",
  COLLECTED_NO_RECEIPT: "collected_no_receipt",
  NOT_DUE: "not_due",
  COLLECTION_FAILED: "collection_failed",
  CONDITIONAL_SKIPPED: "conditional_skipped",
  EVALUATION_ONLY: "evaluation_only",
});

function registryMeta(datasetId) {
  const sdv = SDV_SOURCE_REGISTRY.find((d) => d.id === datasetId);
  if (sdv) {
    return {
      provider: "SDV",
      collectedCurrently: sdv.collectedCurrently,
      championConsumes: sdv.championConsumes,
      name: sdv.name,
    };
  }
  const cfbd = CFBD_ENDPOINT_REGISTRY.find((d) => d.id === datasetId);
  if (cfbd) {
    return {
      provider: "CFBD",
      collectedCurrently: cfbd.collectedCurrently,
      championConsumes: cfbd.championConsumes,
      evaluationOnly: cfbd.evaluationOnly,
      name: cfbd.name,
    };
  }
  return { provider: "unknown", collectedCurrently: false, championConsumes: false, name: datasetId };
}

function scheduleFor(datasetId) {
  return WEEKLY_COLLECTION_SCHEDULE.filter((s) => s.datasets.includes(datasetId));
}

/**
 * @param {{
 *   season:number, week:number,
 *   evidenceByDataset?: object,
 *   livePresence?: object,  // { [datasetId]: { present:boolean, rowCount?:number, source?:string } }
 *   now?: Date,
 *   pregameFreezeFailed?: boolean,
 * }} opts
 */
export function reconcileDueDatasets({
  season = 2026,
  week = 8,
  evidenceByDataset = {},
  livePresence = {},
  now = new Date(),
  pregameFreezeFailed = false,
} = {}) {
  const required = listRequiredDatasets();
  // Conditionally due: SDV live path + pit fallback when freeze fails + evaluation lines
  const conditional = [
    "sdv-team-summaries-2026",
    "sdv-schedules-2026",
    "sdv-pit-fallback",
    "sdv-player-box",
    "sdv-team-box",
    "cfbd-info",
    "cfbd-lines",
  ];
  const allDue = [...new Set([...required, ...conditional])];

  const rows = [];
  for (const datasetId of allDue) {
    const meta = registryMeta(datasetId);
    const schedules = scheduleFor(datasetId);
    const requiredBySchedule = schedules.some((s) => s.required);
    const conditionalOnly = !requiredBySchedule;
    const ev = evidenceByDataset[datasetId] || null;
    const presence = livePresence[datasetId] || null;

    let classification = DUE_CLASS.NOT_DUE;
    let severity = "info";
    let reason = "";

    if (meta.evaluationOnly || datasetId === "cfbd-lines") {
      classification = DUE_CLASS.EVALUATION_ONLY;
      reason = "Evaluation/market only — never enters independent score";
    } else if (datasetId === "sdv-pit-fallback" && !pregameFreezeFailed) {
      classification = DUE_CLASS.CONDITIONAL_SKIPPED;
      reason = "PIT fallback only when CFBD deep-feed integrity fails during freeze";
    } else if ((datasetId === "sdv-player-box" || datasetId === "sdv-team-box") && !meta.collectedCurrently) {
      classification = DUE_CLASS.NOT_DUE;
      reason = "Registered but not on live collection path";
    } else if (ev && (ev.httpOk || ev.rowCount > 0) && (ev.archived || ev.contentHash)) {
      classification = DUE_CLASS.VERIFIED;
      reason = "Verified collection receipt present";
    } else if (presence?.present && !ev) {
      classification = DUE_CLASS.COLLECTED_NO_RECEIPT;
      severity = "error";
      reason = `Data present in ${presence.source || "store"} but no cfb_collection_manifests receipt — persistence gap`;
    } else if (requiredBySchedule && !ev && !presence?.present) {
      classification = DUE_CLASS.COLLECTION_FAILED;
      severity = "error";
      reason = "Required by weekly schedule; no receipt and no live presence evidence";
    } else if (conditionalOnly && !ev) {
      classification = DUE_CLASS.NOT_DUE;
      reason = "Conditionally due / optional — no receipt required this window";
    } else if (ev && !(ev.httpOk || ev.rowCount > 0)) {
      classification = DUE_CLASS.COLLECTION_FAILED;
      severity = "error";
      reason = "Receipt present but collection failed or empty";
    } else {
      classification = DUE_CLASS.NOT_DUE;
      reason = "No due obligation for this window";
    }

    rows.push({
      datasetId,
      provider: meta.provider,
      name: meta.name,
      requiredBySchedule,
      conditionalOnly,
      championConsumes: Boolean(meta.championConsumes),
      classification,
      severity,
      reason,
      receipt: ev
        ? {
            collectedAt: ev.collectedAt || null,
            rowCount: ev.rowCount ?? null,
            teamCoverage: ev.teamCoverage ?? null,
            contentHash: ev.contentHash || null,
          }
        : null,
      livePresence: presence || null,
      schedules: schedules.map((s) => s.id),
    });
  }

  const counts = Object.fromEntries(
    Object.values(DUE_CLASS).map((c) => [c, rows.filter((r) => r.classification === c).length])
  );

  const persistenceGaps = rows.filter((r) => r.classification === DUE_CLASS.COLLECTED_NO_RECEIPT);
  const failures = rows.filter((r) => r.classification === DUE_CLASS.COLLECTION_FAILED);
  const verifiedRequired = rows.filter(
    (r) => r.requiredBySchedule && r.classification === DUE_CLASS.VERIFIED
  );

  return {
    version: COLLECTION_RECON_VERSION,
    season,
    week,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    expectedFbsFloor: EXPECTED_FBS_TEAM_FLOOR,
    dueCount: allDue.length,
    requiredCount: required.length,
    rows,
    counts,
    persistenceGaps,
    failures,
    verifiedRequired: verifiedRequired.length,
    pass:
      failures.length === 0 &&
      persistenceGaps.every((g) => !g.championConsumes || g.livePresence?.present),
    note: "Does not fabricate receipts. COLLECTED_NO_RECEIPT requires repairing manifest persistence going forward.",
  };
}
